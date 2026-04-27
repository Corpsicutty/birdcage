import {
  DEFAULT_PAR,
  defaultHolePars,
  normalizeHolePars,
  normalizeHoleParsArray
} from "../data/course";
import type { PlayerRecord, ScoreRecord, SessionRecord } from "../types";
import { generateSessionCode } from "./sessionCode";
import { supabase } from "./supabase";

export interface SessionSnapshot {
  session: SessionRecord;
  players: PlayerRecord[];
  scores: ScoreRecord[];
}

const SESSION_SELECT =
  "id, code, created_by_token, created_at, expires_at, status, ended_at, hole_pars";

function mapSessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    ...(row as unknown as SessionRecord),
    hole_pars: normalizeHoleParsArray(row.hole_pars)
  };
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  return supabase;
}

async function createEmptyScores(sessionId: string, playerId: string, holeCount: number) {
  const client = requireSupabase();
  if (holeCount < 1) {
    return;
  }
  const rows = Array.from({ length: holeCount }, (_, index) => ({
    session_id: sessionId,
    player_id: playerId,
    hole_number: index + 1,
    strokes: null as null
  }));

  const { error } = await client.from("scores").insert(rows);
  if (error) {
    throw new Error(error.message);
  }
}

export async function createSession(
  playerNames: string[],
  creatorToken: string
): Promise<{ snapshot: SessionSnapshot; activePlayerId: string }> {
  const client = requireSupabase();
  const cleanedNames = playerNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (cleanedNames.length < 1) {
    throw new Error("At least one player name is required.");
  }

  let createdSession: SessionRecord | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateSessionCode(6);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
      .from("sessions")
      .insert({
        code,
        status: "active",
        created_by_token: creatorToken,
        expires_at: expiresAt,
        hole_pars: defaultHolePars()
      })
      .select(SESSION_SELECT)
      .single();

    if (!error && data) {
      createdSession = mapSessionRow(data as Record<string, unknown>);
      break;
    }
    lastError = error?.message ?? "Unable to create session.";
  }

  if (!createdSession) {
    throw new Error(lastError ?? "Unable to generate a unique session code.");
  }

  const holeCount = createdSession.hole_pars.length;

  const playerInserts = cleanedNames.map((name, index) => ({
    session_id: createdSession.id,
    name,
    claim_token: index === 0 ? creatorToken : null
  }));

  const { data: playerRows, error: playersError } = await client
    .from("players")
    .insert(playerInserts)
    .select("*");

  if (playersError || !playerRows) {
    throw new Error(playersError?.message ?? "Unable to create players.");
  }

  for (const player of playerRows as PlayerRecord[]) {
    await createEmptyScores(createdSession.id, player.id, holeCount);
  }

  const snapshot = await getSessionSnapshot(createdSession.id);
  const creatorPlayer = snapshot.players.find(
    (player) => player.claim_token === creatorToken
  );

  if (!creatorPlayer) {
    throw new Error("Unable to identify the creator player.");
  }

  return { snapshot, activePlayerId: creatorPlayer.id };
}

export async function getSessionByCode(code: string): Promise<SessionRecord | null> {
  const client = requireSupabase();
  const trimmed = code.trim().toUpperCase();

  const { data, error } = await client
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("code", trimmed)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(error.message);
  }

  const session = mapSessionRow(data as Record<string, unknown>);
  const isExpired = new Date(session.expires_at).getTime() <= Date.now();
  if (session.status !== "active" || isExpired) {
    return null;
  }

  return session;
}

export async function getSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const client = requireSupabase();

  const [{ data: sessionData, error: sessionError }, { data: players, error: playersError }, { data: scores, error: scoresError }] =
    await Promise.all([
      client.from("sessions").select(SESSION_SELECT).eq("id", sessionId).single(),
      client.from("players").select("*").eq("session_id", sessionId).order("created_at"),
      client.from("scores").select("*").eq("session_id", sessionId)
    ]);

  if (sessionError || !sessionData) {
    throw new Error(sessionError?.message ?? "Session not found.");
  }
  if (playersError || !players) {
    throw new Error(playersError?.message ?? "Unable to load players.");
  }
  if (scoresError || !scores) {
    throw new Error(scoresError?.message ?? "Unable to load scores.");
  }

  return {
    session: mapSessionRow(sessionData as Record<string, unknown>),
    players: players as PlayerRecord[],
    scores: scores as ScoreRecord[]
  };
}

export async function claimPlayer(
  playerId: string,
  playerToken: string
): Promise<PlayerRecord> {
  const client = requireSupabase();
  const { data: playerData, error: playerFetchError } = await client
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single();

  if (playerFetchError || !playerData) {
    throw new Error(playerFetchError?.message ?? "Player not found.");
  }

  const player = playerData as PlayerRecord;
  if (player.claim_token && player.claim_token !== playerToken) {
    throw new Error("This name is already claimed.");
  }

  const { data, error } = await client
    .from("players")
    .update({ claim_token: playerToken })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to claim name.");
  }

  return data as PlayerRecord;
}

export async function addPlayer(
  sessionId: string,
  name: string,
  claimToken: string
): Promise<PlayerRecord> {
  const client = requireSupabase();
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Enter a player name.");
  }

  const { data, error } = await client
    .from("players")
    .insert({ session_id: sessionId, name: trimmed, claim_token: claimToken })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create player.");
  }

  const snap = await getSessionSnapshot(sessionId);
  const holeCount = snap.session.hole_pars.length;
  await createEmptyScores(sessionId, (data as PlayerRecord).id, holeCount);
  return data as PlayerRecord;
}

export async function setScore(
  sessionId: string,
  playerId: string,
  holeNumber: number,
  strokes: number
) {
  const client = requireSupabase();
  const { error } = await client.from("scores").upsert(
    {
      session_id: sessionId,
      player_id: playerId,
      hole_number: holeNumber,
      strokes
    },
    { onConflict: "player_id,hole_number" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function endSession(sessionId: string) {
  const client = requireSupabase();
  const { error } = await client
    .from("sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function setSessionHolePars(sessionId: string, holePars: number[]) {
  const client = requireSupabase();
  const normalized = normalizeHoleParsArray(holePars);
  const { error } = await client
    .from("sessions")
    .update({ hole_pars: normalized })
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

/** Appends new holes to the end of the round (par list + null score rows for all players). */
export async function appendHolesToSession(sessionId: string, additionalPars: number[]) {
  const client = requireSupabase();
  if (additionalPars.length === 0) {
    return;
  }
  const snap = await getSessionSnapshot(sessionId);
  const current = snap.session.hole_pars;
  const tail = additionalPars.map((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(6, Math.max(2, n)) : DEFAULT_PAR;
  });
  const nextPars = [...current, ...tail];
  const { error: upErr } = await client
    .from("sessions")
    .update({ hole_pars: nextPars })
    .eq("id", sessionId);
  if (upErr) {
    throw new Error(upErr.message);
  }

  const fromHole = current.length + 1;
  const toHole = nextPars.length;
  const rows: {
    session_id: string;
    player_id: string;
    hole_number: number;
    strokes: null;
  }[] = [];
  for (const player of snap.players) {
    for (let h = fromHole; h <= toHole; h += 1) {
      rows.push({ session_id: sessionId, player_id: player.id, hole_number: h, strokes: null });
    }
  }
  if (rows.length > 0) {
    const { error: insErr } = await client.from("scores").insert(rows);
    if (insErr) {
      throw new Error(insErr.message);
    }
  }
}

/** Renumbers scores after a hole; deletes back-nine+ holes, updates hole_pars. */
export async function removeHoleFromGroupSession(sessionId: string, holeNumber: number) {
  const client = requireSupabase();
  const snap = await getSessionSnapshot(sessionId);
  if (holeNumber <= 9 || holeNumber > snap.session.hole_pars.length) {
    return;
  }
  const { error: dErr } = await client
    .from("scores")
    .delete()
    .eq("session_id", sessionId)
    .eq("hole_number", holeNumber);
  if (dErr) {
    throw new Error(dErr.message);
  }

  // One update per shifted hole, all players in one request each (not one row at a time).
  const maxHole = snap.session.hole_pars.length;
  for (let h = holeNumber + 1; h <= maxHole; h += 1) {
    const { error: uErr } = await client
      .from("scores")
      .update({ hole_number: h - 1 })
      .eq("session_id", sessionId)
      .eq("hole_number", h);
    if (uErr) {
      throw new Error(uErr.message);
    }
  }

  const nextPars = snap.session.hole_pars.filter((_, index) => index !== holeNumber - 1);
  const { error: pErr } = await client
    .from("sessions")
    .update({ hole_pars: nextPars })
    .eq("id", sessionId);
  if (pErr) {
    throw new Error(pErr.message);
  }
}

export async function clearStrokesOnHoleForSession(sessionId: string, holeNumber: number) {
  const client = requireSupabase();
  const { error } = await client
    .from("scores")
    .delete()
    .eq("session_id", sessionId)
    .eq("hole_number", holeNumber);
  if (error) {
    throw new Error(error.message);
  }
}

export async function clearAllScoresInGroupSession(sessionId: string) {
  const client = requireSupabase();
  const snap = await getSessionSnapshot(sessionId);
  const { error } = await client.from("scores").delete().eq("session_id", sessionId);
  if (error) {
    throw new Error(error.message);
  }
  const n = snap.session.hole_pars.length;
  for (const p of snap.players) {
    await createEmptyScores(sessionId, p.id, n);
  }
}

export async function resetGroupSessionRoundToFrontNine(sessionId: string) {
  const client = requireSupabase();
  const snap = await getSessionSnapshot(sessionId);
  const { error } = await client.from("scores").delete().eq("session_id", sessionId);
  if (error) {
    throw new Error(error.message);
  }
  const pars = defaultHolePars();
  const { error: uErr } = await client
    .from("sessions")
    .update({ hole_pars: pars })
    .eq("id", sessionId);
  if (uErr) {
    throw new Error(uErr.message);
  }
  for (const p of snap.players) {
    await createEmptyScores(sessionId, p.id, pars.length);
  }
}

export { normalizeHolePars };
