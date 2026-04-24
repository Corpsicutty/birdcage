import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PAR,
  HOLES,
  PAR_MAX,
  PAR_MIN,
  defaultHolePars,
  sumHolePars,
  withHoleParReplaced
} from "./data/course";
import {
  addPlayer,
  claimPlayer,
  createSession,
  endSession,
  getSessionByCode,
  getSessionSnapshot,
  setScore,
  setSessionHolePars,
  type SessionSnapshot
} from "./lib/api";
import {
  clearActiveGroupSession,
  getOrCreatePlayerToken,
  readSoloSession,
  readActiveGroupSession,
  type ActiveGroupSessionV1,
  writeActiveGroupSession,
  writeSoloSession
} from "./lib/storage";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { PlayerRecord } from "./types";
import flagImg from "../img/flag.png";
import headerImg from "../img/header.png";
import buyMeCoffeeIcon from "../img/buy-me-coffee-icon.png";

type View = "splash" | "group-menu" | "join-session" | "new-session" | "claim-name" | "play";
type PlayMode = "solo" | "group" | null;
type SoloResetAction = "hole" | "scores" | "round";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) {
    return "?";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function formatRelative(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  if (value < 0) {
    return `${value}`;
  }
  return "E";
}

export default function App() {
  const storedSolo = useMemo(() => readSoloSession(), []);
  const playerToken = useMemo(() => getOrCreatePlayerToken(), []);
  const [view, setView] = useState<View>("splash");
  const [playMode, setPlayMode] = useState<PlayMode>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [rejoinable, setRejoinable] = useState<ActiveGroupSessionV1 | null>(null);

  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<SessionSnapshot | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [currentHole, setCurrentHole] = useState(() => {
    const maxHole = Math.max(1, storedSolo?.holePars?.length ?? defaultHolePars().length);
    return Math.min(Math.max(1, storedSolo?.lastHole ?? 1), maxHole);
  });

  const [joinCode, setJoinCode] = useState("");
  const [newSessionNames, setNewSessionNames] = useState<string[]>(["", ""]);
  const [newJoinName, setNewJoinName] = useState("");

  const [soloName, setSoloName] = useState(() => storedSolo?.name ?? "");
  const [soloScores, setSoloScores] = useState<Record<number, number | null>>(
    () => storedSolo?.scores ?? {}
  );
  const [soloHolePars, setSoloHolePars] = useState(() => storedSolo?.holePars ?? defaultHolePars());

  const [parDialogOpen, setParDialogOpen] = useState(false);
  const [parEditHole, setParEditHole] = useState<number | null>(null);
  const [parDraft, setParDraft] = useState(String(DEFAULT_PAR));
  const [soloMenuOpen, setSoloMenuOpen] = useState(false);
  const [soloResetConfirmOpen, setSoloResetConfirmOpen] = useState(false);
  const [pendingSoloReset, setPendingSoloReset] = useState<SoloResetAction | null>(null);

  const parLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const soloHoles = useMemo(
    () => Array.from({ length: soloHolePars.length }, (_, index) => ({ number: index + 1 })),
    [soloHolePars.length]
  );

  const activeHole =
    playMode === "solo"
      ? soloHoles[currentHole - 1] ?? { number: 1 }
      : HOLES[currentHole - 1] ?? HOLES[0];
  const activePlayer =
    playMode === "group"
      ? snapshot?.players.find((player) => player.id === activePlayerId) ?? null
      : null;
  const canEditGroupScore =
    playMode === "group" &&
    !!activePlayer &&
    activePlayer.claim_token === playerToken &&
    snapshot?.session.status === "active" &&
    new Date(snapshot.session.expires_at).getTime() > Date.now();

  const players = playMode === "group" ? snapshot?.players ?? [] : [];

  const isSessionCreator =
    playMode === "group" && !!snapshot && snapshot.session.created_by_token === playerToken;
  const canEditPar = playMode === "solo" || isSessionCreator;

  function parForHole(holeNumber: number): number {
    if (playMode === "solo") {
      return soloHolePars[holeNumber - 1] ?? DEFAULT_PAR;
    }
    if (playMode === "group" && snapshot) {
      return snapshot.session.hole_pars[holeNumber - 1] ?? DEFAULT_PAR;
    }
    return DEFAULT_PAR;
  }

  const activePar = parForHole(currentHole);
  const totalParForTable = useMemo(() => {
    if (playMode === "solo") {
      return sumHolePars(soloHolePars);
    }
    if (playMode === "group" && snapshot) {
      return sumHolePars(snapshot.session.hole_pars);
    }
    return 0;
  }, [playMode, soloHolePars, snapshot?.session.hole_pars]);

  function clearParLongPress() {
    if (parLongPressTimer.current) {
      clearTimeout(parLongPressTimer.current);
    }
    parLongPressTimer.current = null;
  }

  function startParLongPress(holeNumber: number) {
    if (!canEditPar) {
      return;
    }
    clearParLongPress();
    parLongPressTimer.current = setTimeout(() => {
      parLongPressTimer.current = null;
      openParDialog(holeNumber);
    }, 550);
  }

  function openParDialog(holeNumber: number) {
    if (playMode === "solo") {
      // allow
    } else if (playMode === "group" && snapshot && snapshot.session.created_by_token === playerToken) {
      // allow
    } else {
      return;
    }
    clearParLongPress();
    setParEditHole(holeNumber);
    setParDraft(String(parForHole(holeNumber)));
    setParDialogOpen(true);
  }

  function resetToSplash() {
    setView("splash");
    setPlayMode(null);
    setSnapshot(null);
    setPendingSnapshot(null);
    setActivePlayerId(null);
    setCurrentHole(1);
    setError(null);
    setEndConfirmOpen(false);
    setSoloMenuOpen(false);
    setSoloResetConfirmOpen(false);
    setPendingSoloReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    clearParLongPress();
    clearActiveGroupSession();
    setRejoinable(null);
  }

  function returnToMenuFromGroupFlow() {
    setView("splash");
    setPlayMode(null);
    setSnapshot(null);
    setPendingSnapshot(null);
    setActivePlayerId(null);
    setCurrentHole(1);
    setError(null);
    setEndConfirmOpen(false);
    setSoloMenuOpen(false);
    setSoloResetConfirmOpen(false);
    setPendingSoloReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    clearParLongPress();
    setJoinCode("");
  }

  function returnToMenuFromPlay() {
    setView("splash");
    setPlayMode(null);
    setSnapshot(null);
    setPendingSnapshot(null);
    setActivePlayerId(null);
    setError(null);
    setEndConfirmOpen(false);
    setSoloMenuOpen(false);
    setSoloResetConfirmOpen(false);
    setPendingSoloReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    clearParLongPress();

    const stored = readActiveGroupSession();
    if (stored) {
      setRejoinable(stored);
      setJoinCode(stored.code);
    } else {
      setRejoinable(null);
    }
  }

  async function validateStoredGroupSession(
    data: ActiveGroupSessionV1
  ): Promise<boolean> {
    if (!isSupabaseConfigured) {
      return false;
    }
    try {
      const next = await getSessionSnapshot(data.sessionId);
      if (next.session.status !== "active") {
        return false;
      }
      if (new Date(next.session.expires_at).getTime() <= Date.now()) {
        return false;
      }
      const player = next.players.find((row) => row.id === data.playerId);
      if (!player) {
        return false;
      }
      if (player.claim_token && player.claim_token !== playerToken) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setRejoinable(null);
      return;
    }

    const stored = readActiveGroupSession();
    if (!stored) {
      setRejoinable(null);
      return;
    }

    setRejoinable(stored);
    void (async () => {
      const valid = await validateStoredGroupSession(stored);
      if (!valid) {
        clearActiveGroupSession();
        setRejoinable(null);
      }
    })();
  }, [isSupabaseConfigured, playerToken]);

  useEffect(() => {
    if (playMode !== "group" || !snapshot || !activePlayerId) {
      return;
    }

    writeActiveGroupSession({
      v: 1,
      sessionId: snapshot.session.id,
      code: snapshot.session.code,
      playerId: activePlayerId,
      lastHole: currentHole
    });
  }, [playMode, snapshot?.session.id, activePlayerId, currentHole]);

  useEffect(() => {
    const maxHole = Math.max(1, soloHolePars.length);
    const safeLastHole = Math.min(Math.max(1, currentHole), maxHole);
    writeSoloSession({
      v: 1,
      name: soloName,
      scores: soloScores,
      holePars: soloHolePars,
      lastHole: safeLastHole
    });
  }, [soloName, soloScores, soloHolePars, currentHole]);

  useEffect(() => {
    if (playMode !== "group" || !snapshot) {
      return;
    }
    const stored = readActiveGroupSession();
    if (!stored || stored.sessionId !== snapshot.session.id) {
      return;
    }
    if (snapshot.session.code !== stored.code) {
      writeActiveGroupSession({ ...stored, code: snapshot.session.code });
    }
  }, [playMode, snapshot?.session.code, snapshot?.session.id]);

  async function handleRejoinActiveGame() {
    const stored = readActiveGroupSession();
    if (!stored) {
      setRejoinable(null);
      return;
    }
    if (!isSupabaseConfigured) {
      setError("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const valid = await validateStoredGroupSession(stored);
      if (!valid) {
        clearActiveGroupSession();
        setRejoinable(null);
        setError("That group session is no longer available.");
        return;
      }

      const next = await getSessionSnapshot(stored.sessionId);
      setSnapshot(next);
      setActivePlayerId(stored.playerId);
      setCurrentHole(
        Math.min(
          Math.max(1, stored.lastHole),
          HOLES[HOLES.length - 1].number
        )
      );
      setPlayMode("group");
      setView("play");
    } catch (rejoinError) {
      setError(rejoinError instanceof Error ? rejoinError.message : "Unable to rejoin session.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshSnapshot(sessionId: string) {
    const next = await getSessionSnapshot(sessionId);
    setSnapshot(next);
    const alreadySelected = next.players.find((player) => player.id === activePlayerId);
    if (!alreadySelected) {
      const claimed = next.players.find((player) => player.claim_token === playerToken);
      setActivePlayerId(claimed?.id ?? next.players[0]?.id ?? null);
    }
  }

  async function saveParFromDialog() {
    if (parEditHole == null) {
      return;
    }
    const parsed = Math.floor(Number(parDraft));
    if (!Number.isFinite(parsed)) {
      setError("Enter a number for par.");
      return;
    }
    const clamped = Math.min(PAR_MAX, Math.max(PAR_MIN, parsed));
    setError(null);

    if (playMode === "solo") {
      setSoloHolePars((current) =>
        current.map((par, index) => (index === parEditHole - 1 ? clamped : par))
      );
      setParDialogOpen(false);
      return;
    }

    if (playMode === "group" && snapshot) {
      setLoading(true);
      const next = withHoleParReplaced(snapshot.session.hole_pars, parEditHole, clamped);
      setSnapshot((current) =>
        current && current.session.id === snapshot.session.id
          ? { ...current, session: { ...current.session, hole_pars: next } }
          : current
      );
      try {
        await setSessionHolePars(snapshot.session.id, next);
        setParDialogOpen(false);
        await refreshSnapshot(snapshot.session.id);
      } catch (parError) {
        setError(parError instanceof Error ? parError.message : "Unable to update par.");
        await refreshSnapshot(snapshot.session.id);
      } finally {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const client = supabase;
    if (!snapshot || playMode !== "group" || !client) {
      return;
    }

    const sessionId = snapshot.session.id;
    const channel = client
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores", filter: `session_id=eq.${sessionId}` },
        () => {
          void refreshSnapshot(sessionId);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `session_id=eq.${sessionId}` },
        () => {
          void refreshSnapshot(sessionId);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
        () => {
          void refreshSnapshot(sessionId);
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [playMode, snapshot?.session.id]);

  function getGroupStroke(playerId: string, holeNumber: number): number | null {
    if (!snapshot) {
      return null;
    }
    return (
      snapshot.scores.find(
        (score) => score.player_id === playerId && score.hole_number === holeNumber
      )?.strokes ?? null
    );
  }

  function getPlayerRelative(player: PlayerRecord): number {
    if (!snapshot) {
      return 0;
    }

    return HOLES.reduce((sum, hole) => {
      const strokes = getGroupStroke(player.id, hole.number);
      if (strokes == null) {
        return sum;
      }
      const par = snapshot.session.hole_pars[hole.number - 1] ?? DEFAULT_PAR;
      return sum + (strokes - par);
    }, 0);
  }

  function getActiveStroke(): number | null {
    if (playMode === "solo") {
      return soloScores[activeHole.number] ?? null;
    }
    if (!activePlayer || !snapshot) {
      return null;
    }
    return getGroupStroke(activePlayer.id, activeHole.number);
  }

  function applyLocalSnapshotScore(
    sessionId: string,
    playerId: string,
    holeNumber: number,
    strokes: number
  ) {
    setSnapshot((current) => {
      if (!current || current.session.id !== sessionId) {
        return current;
      }

      const scoreIndex = current.scores.findIndex(
        (score) => score.player_id === playerId && score.hole_number === holeNumber
      );

      if (scoreIndex < 0) {
        return {
          ...current,
          scores: [
            ...current.scores,
            {
              id: crypto.randomUUID(),
              session_id: sessionId,
              player_id: playerId,
              hole_number: holeNumber,
              strokes
            }
          ]
        };
      }

      const nextScores = [...current.scores];
      nextScores[scoreIndex] = {
        ...nextScores[scoreIndex],
        strokes
      };

      return {
        ...current,
        scores: nextScores
      };
    });
  }

  async function handleStrokeChange(delta: number) {
    setError(null);
    const base = getActiveStroke() ?? 1;
    const nextStroke = Math.max(1, Math.min(20, base + delta));

    if (playMode === "solo") {
      setSoloScores((current) => ({
        ...current,
        [activeHole.number]: nextStroke
      }));
      return;
    }

    if (!snapshot || !activePlayerId || !canEditGroupScore) {
      return;
    }

    applyLocalSnapshotScore(snapshot.session.id, activePlayerId, activeHole.number, nextStroke);
    try {
      await setScore(snapshot.session.id, activePlayerId, activeHole.number, nextStroke);
    } catch (scoreError) {
      setError(
        scoreError instanceof Error ? scoreError.message : "Unable to update score right now."
      );
      await refreshSnapshot(snapshot.session.id);
    }
  }

  function expandSoloToBackNine() {
    setSoloHolePars((current) => {
      return [...current, ...Array.from({ length: 9 }, () => DEFAULT_PAR)];
    });
  }

  function addSoloHole() {
    setSoloHolePars((current) => [...current, DEFAULT_PAR]);
  }

  function deleteSoloHole(holeNumber: number) {
    if (holeNumber <= 9 || holeNumber > soloHolePars.length) {
      return;
    }

    const removeIndex = holeNumber - 1;
    setSoloHolePars((current) => current.filter((_, index) => index !== removeIndex));
    setSoloScores((current) => {
      const next: Record<number, number | null> = {};
      for (let number = 1; number <= soloHolePars.length; number += 1) {
        if (number === holeNumber) {
          continue;
        }
        const targetNumber = number > holeNumber ? number - 1 : number;
        next[targetNumber] = current[number] ?? null;
      }
      return next;
    });
    setCurrentHole((current) => {
      if (current === holeNumber) {
        return Math.max(1, Math.min(current, soloHolePars.length - 1));
      }
      if (current > holeNumber) {
        return current - 1;
      }
      return current;
    });
  }

  async function handleCreateSession() {
    if (!isSupabaseConfigured) {
      setError("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { snapshot: createdSnapshot, activePlayerId: creatorPlayerId } =
        await createSession(newSessionNames, playerToken);
      setSnapshot(createdSnapshot);
      setActivePlayerId(creatorPlayerId);
      setPlayMode("group");
      setView("play");
      setCurrentHole(1);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to start session.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinSessionLookup() {
    if (!isSupabaseConfigured) {
      setError("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await getSessionByCode(joinCode);
      if (!session) {
        setError("Session not found or has expired.");
        return;
      }

      const nextSnapshot = await getSessionSnapshot(session.id);
      const claimed = nextSnapshot.players.find((player) => player.claim_token === playerToken);

      if (claimed) {
        setSnapshot(nextSnapshot);
        setActivePlayerId(claimed.id);
        setPlayMode("group");
        setView("play");
        return;
      }

      setPendingSnapshot(nextSnapshot);
      setView("claim-name");
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join session.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimExisting(playerId: string) {
    if (!pendingSnapshot) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await claimPlayer(playerId, playerToken);
      const nextSnapshot = await getSessionSnapshot(pendingSnapshot.session.id);
      setSnapshot(nextSnapshot);
      setActivePlayerId(playerId);
      setPlayMode("group");
      setView("play");
      setPendingSnapshot(null);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Unable to claim player.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAndClaim() {
    if (!pendingSnapshot) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const createdPlayer = await addPlayer(
        pendingSnapshot.session.id,
        newJoinName,
        playerToken
      );
      const nextSnapshot = await getSessionSnapshot(pendingSnapshot.session.id);
      setSnapshot(nextSnapshot);
      setActivePlayerId(createdPlayer.id);
      setPlayMode("group");
      setView("play");
      setPendingSnapshot(null);
      setNewJoinName("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add player.");
    } finally {
      setLoading(false);
    }
  }

  async function executeEndGame() {
    setEndConfirmOpen(false);
    if (playMode !== "group" || !snapshot) {
      resetToSplash();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await endSession(snapshot.session.id);
      resetToSplash();
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Unable to end game.");
    } finally {
      setLoading(false);
    }
  }

  function requestSoloReset(action: SoloResetAction) {
    setSoloMenuOpen(false);
    setPendingSoloReset(action);
    setSoloResetConfirmOpen(true);
  }

  function executeSoloReset() {
    if (!pendingSoloReset) {
      return;
    }

    if (pendingSoloReset === "hole") {
      setSoloScores((current) => {
        const next = { ...current };
        delete next[activeHole.number];
        return next;
      });
    } else if (pendingSoloReset === "scores") {
      setSoloScores({});
    } else if (pendingSoloReset === "round") {
      setSoloScores({});
      setSoloHolePars(defaultHolePars());
      setCurrentHole(1);
    }

    setSoloResetConfirmOpen(false);
    setPendingSoloReset(null);
  }

  function renderScoreTable() {
    if (playMode === "solo") {
      const relative = soloHoles.reduce((sum, hole) => {
        const strokes = soloScores[hole.number];
        if (strokes == null) {
          return sum;
        }
        const par = soloHolePars[hole.number - 1] ?? DEFAULT_PAR;
        return sum + (strokes - par);
      }, 0);
      const frontHoles = soloHoles.filter((hole) => hole.number <= 9);
      const backHoles = soloHoles.filter((hole) => hole.number > 9);
      const frontRelative = frontHoles.reduce((sum, hole) => {
        const strokes = soloScores[hole.number];
        if (strokes == null) {
          return sum;
        }
        const par = soloHolePars[hole.number - 1] ?? DEFAULT_PAR;
        return sum + (strokes - par);
      }, 0);
      const backRelative = backHoles.reduce((sum, hole) => {
        const strokes = soloScores[hole.number];
        if (strokes == null) {
          return sum;
        }
        const par = soloHolePars[hole.number - 1] ?? DEFAULT_PAR;
        return sum + (strokes - par);
      }, 0);
      const frontParTotal = frontHoles.reduce(
        (sum, hole) => sum + (soloHolePars[hole.number - 1] ?? DEFAULT_PAR),
        0
      );
      const backParTotal = backHoles.reduce(
        (sum, hole) => sum + (soloHolePars[hole.number - 1] ?? DEFAULT_PAR),
        0
      );
      const backSummaryLabel = backHoles.length <= 9 ? "Back 9" : `Back ${backHoles.length}`;

      return (
        <div className="score-table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>HOLE</th>
                <th>PAR</th>
                <th>
                  <label className="solo-name-header-wrap">
                    <input
                      className="solo-name-header-input"
                      value={soloName}
                      onChange={(event) => setSoloName(event.target.value)}
                      placeholder="Enter Name"
                      aria-label="Solo player name"
                    />
                  </label>
                </th>
              </tr>
            </thead>
            <tbody>
              {frontHoles.map((hole) => (
                <tr key={hole.number}>
                  <td className={hole.number > 9 ? "solo-hole-cell solo-hole-cell--deletable" : "solo-hole-cell"}>
                    <div className="hole-number-cell-content">
                      <span className="hole-symbol-slot" aria-hidden="true" />
                      <span className="hole-number-value">{hole.number}</span>
                    </div>
                  </td>
                  <td
                    className={canEditPar ? "par-cell par-cell--editable" : "par-cell"}
                    onPointerDown={canEditPar ? () => startParLongPress(hole.number) : undefined}
                    onPointerUp={canEditPar ? () => clearParLongPress() : undefined}
                    onPointerCancel={canEditPar ? () => clearParLongPress() : undefined}
                    onPointerLeave={canEditPar ? () => clearParLongPress() : undefined}
                  >
                    {parForHole(hole.number)}
                  </td>
                  <td>{soloScores[hole.number] ?? "-"}</td>
                </tr>
              ))}
              <tr className="totals-row">
                <td>
                  <div className="totals-label-wrap hole-number-cell-content">
                    <span className="hole-symbol-slot">
                      <button
                        className="expand-holes-button"
                        type="button"
                        onClick={expandSoloToBackNine}
                        aria-label="Add nine more holes"
                      >
                        +
                      </button>
                    </span>
                    <span className="hole-number-value">Front 9</span>
                  </div>
                </td>
                <td>{frontParTotal}</td>
                <td>{formatRelative(frontRelative)}</td>
              </tr>
              {backHoles.map((hole) => (
                <tr key={hole.number}>
                  <td className={hole.number > 9 ? "solo-hole-cell solo-hole-cell--deletable" : "solo-hole-cell"}>
                    <div className="hole-number-cell-content">
                      <span className="hole-symbol-slot">
                        {hole.number > 9 && (
                          <button
                            className="solo-hole-delete"
                            type="button"
                            onClick={() => deleteSoloHole(hole.number)}
                            aria-label={`Remove hole ${hole.number}`}
                          >
                            -
                          </button>
                        )}
                      </span>
                      <span className="hole-number-value">{hole.number}</span>
                    </div>
                  </td>
                  <td
                    className={canEditPar ? "par-cell par-cell--editable" : "par-cell"}
                    onPointerDown={canEditPar ? () => startParLongPress(hole.number) : undefined}
                    onPointerUp={canEditPar ? () => clearParLongPress() : undefined}
                    onPointerCancel={canEditPar ? () => clearParLongPress() : undefined}
                    onPointerLeave={canEditPar ? () => clearParLongPress() : undefined}
                  >
                    {parForHole(hole.number)}
                  </td>
                  <td>{soloScores[hole.number] ?? "-"}</td>
                </tr>
              ))}
              <tr className="hole-add-row">
                <td className="solo-hole-cell">
                  <div className="hole-number-cell-content">
                    <span className="hole-symbol-slot">
                      <button
                        className="expand-holes-button"
                        type="button"
                        onClick={addSoloHole}
                        aria-label="Add one hole"
                      >
                        +
                      </button>
                    </span>
                    <span className="hole-number-value">{soloHolePars.length + 1}</span>
                  </div>
                </td>
                <td>-</td>
                <td>-</td>
              </tr>
              {backHoles.length > 0 && (
                <tr className="totals-row">
                  <td>{backSummaryLabel}</td>
                  <td>{backParTotal}</td>
                  <td>{formatRelative(backRelative)}</td>
                </tr>
              )}
              <tr className="totals-row">
                <td>Total</td>
                <td>{totalParForTable}</td>
                <td>{formatRelative(relative)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    if (!snapshot) {
      return null;
    }

    return (
      <div className="score-table-wrap">
        <table className="score-table">
          <thead>
            <tr>
              <th>HOLE</th>
              <th>PAR</th>
              {snapshot.players.map((player) => (
                <th key={player.id}>{player.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOLES.map((hole) => (
              <tr key={hole.number}>
                <td>{hole.number}</td>
                <td
                  className={canEditPar ? "par-cell par-cell--editable" : "par-cell"}
                  onPointerDown={canEditPar ? () => startParLongPress(hole.number) : undefined}
                  onPointerUp={canEditPar ? () => clearParLongPress() : undefined}
                  onPointerCancel={canEditPar ? () => clearParLongPress() : undefined}
                  onPointerLeave={canEditPar ? () => clearParLongPress() : undefined}
                >
                  {parForHole(hole.number)}
                </td>
                {snapshot.players.map((player) => (
                  <td key={`${hole.number}-${player.id}`}>
                    {getGroupStroke(player.id, hole.number) ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="totals-row">
              <td>Front 9</td>
              <td>{totalParForTable}</td>
              {snapshot.players.map((player) => (
                <td key={`total-${player.id}`}>{formatRelative(getPlayerRelative(player))}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="app-shell">
      <section className="phone-frame">
        {view === "splash" && (
          <div className="screen splash-screen">
            <img src={headerImg} alt="" className="header-img" />
            <div className="card splash-card">
              <h1 className="brand-title">Birdcage</h1>
              <p className="splash-subtitle">
                <strong>Join an existing game session or generate a new one.</strong> Your friends will be able
                to join the session and keep their own score while they play. All the scores will update live for
                all players to see.
              </p>
              <div className="splash-actions">
                <button className="secondary-button" onClick={() => setView("group-menu")}>
                  <span className="button-icon button-icon--group" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="button-label">Play With Group</span>
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setPlayMode("solo");
                    const maxHole = Math.max(1, soloHolePars.length);
                    setCurrentHole((current) => Math.min(Math.max(1, current), maxHole));
                    setView("play");
                  }}
                >
                  <span className="button-icon button-icon--solo" aria-hidden="true" />
                  <span className="button-label">Play Solo</span>
                </button>
                {rejoinable && (
                  <div className="rejoin-block">
                    <button
                      className="rejoin-button"
                      type="button"
                      onClick={() => void handleRejoinActiveGame()}
                      disabled={loading}
                    >
                      <span className="button-icon button-icon--rejoin" aria-hidden="true">
                        ↺
                      </span>
                      <span className="button-label">Rejoin active game</span>
                    </button>
                    <p className="rejoin-code">Code {rejoinable.code}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="splash-support">
              <a
                className="support-link"
                href="https://buymeacoffee.com/JerJones"
                target="_blank"
                rel="noreferrer"
              >
                <img src={buyMeCoffeeIcon} alt="" className="support-link-icon" />
                <span>buymeacoffee.com/JerJones</span>
              </a>
            </div>
          </div>
        )}

        {view === "group-menu" && (
          <div className="screen simple-screen group-session-screen">
            <h2>Group Session</h2>
            <p className="group-session-subtitle">
              <strong>Join an existing game session or generate a new one.</strong> Your friends will be able
              to join the session and keep their own score while they play. All the scores will update live for
              all players to see.
            </p>
            <div className="group-session-actions">
              <button className="secondary-button" onClick={() => setView("new-session")}>
                New Session
              </button>
              <button className="primary-button" onClick={() => setView("join-session")}>
                Join Session
              </button>
              <button className="ghost-button" onClick={returnToMenuFromGroupFlow}>
                Back
              </button>
            </div>
          </div>
        )}

        {view === "join-session" && (
          <div className="screen simple-screen join-session-screen">
            <label className="field-label field-label--join-code" htmlFor="join-code">
              Enter Session Code
            </label>
            <input
              id="join-code"
              className="text-input uppercase"
              maxLength={6}
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
            />
            <div className="inline-actions">
              <button className="ghost-button" onClick={() => setView("group-menu")}>
                Back
              </button>
              <button
                className="primary-button"
                disabled={loading || joinCode.trim().length !== 6}
                onClick={() => void handleJoinSessionLookup()}
              >
                {loading ? "Joining..." : "Continue"}
              </button>
            </div>
          </div>
        )}

        {view === "new-session" && (
          <div className="screen simple-screen">
            <h2>New Session</h2>
            <p>Enter at least two player names. The first name is you.</p>
            <div className="fields-stack">
              {newSessionNames.map((name, index) => (
                <input
                  key={`new-player-${index}`}
                  className="text-input"
                  value={name}
                  placeholder={`Player ${index + 1}`}
                  onChange={(event) => {
                    const nextNames = [...newSessionNames];
                    nextNames[index] = event.target.value;
                    setNewSessionNames(nextNames);
                  }}
                />
              ))}
            </div>
            <button
              className="icon-add-button"
              onClick={() => setNewSessionNames([...newSessionNames, ""])}
            >
              + Add Player
            </button>
            <div className="inline-actions">
              <button className="ghost-button" onClick={() => setView("group-menu")}>
                Back
              </button>
              <button className="primary-button" disabled={loading} onClick={() => void handleCreateSession()}>
                {loading ? "Creating..." : "Create Session"}
              </button>
            </div>
          </div>
        )}

        {view === "claim-name" && pendingSnapshot && (
          <div className="screen simple-screen">
            <h2>Claim Your Name</h2>
            <p>
              Session <strong>{pendingSnapshot.session.code}</strong>
            </p>
            <div className="claim-list">
              {pendingSnapshot.players
                .filter((player) => !player.claim_token || player.claim_token === playerToken)
                .map((player) => (
                  <button
                    key={player.id}
                    className="claim-button"
                    onClick={() => void handleClaimExisting(player.id)}
                    disabled={loading}
                  >
                    Claim {player.name}
                  </button>
                ))}
            </div>
            <div className="inline-input-row">
              <input
                className="text-input"
                value={newJoinName}
                onChange={(event) => setNewJoinName(event.target.value)}
                placeholder="Or enter a new name"
              />
              <button
                className="secondary-button"
                onClick={() => void handleCreateAndClaim()}
                disabled={loading || newJoinName.trim().length < 2}
              >
                Add
              </button>
            </div>
            <button className="ghost-button" onClick={() => setView("join-session")}>
              Back
            </button>
          </div>
        )}

        {view === "play" && (
          <div
            className="screen play-screen"
            onClick={() => {
              if (soloMenuOpen) {
                setSoloMenuOpen(false);
              }
            }}
          >
            <header className="top-header">
              <button className="icon-text-button" onClick={returnToMenuFromPlay} type="button">
                &larr;
              </button>
              <div className="header-center">
                <h2>Hole {activeHole.number}</h2>
                <p className="hole-meta">
                  {canEditPar ? (
                    <span
                      className="par-tap"
                      onContextMenu={(event) => {
                        event.preventDefault();
                      }}
                      onPointerDown={() => {
                        startParLongPress(currentHole);
                      }}
                      onPointerUp={() => {
                        clearParLongPress();
                      }}
                      onPointerCancel={() => {
                        clearParLongPress();
                      }}
                      onPointerLeave={() => {
                        clearParLongPress();
                      }}
                    >
                      Par {activePar}
                    </span>
                  ) : (
                    <span>Par {activePar}</span>
                  )}
                </p>
              </div>
              {playMode === "group" && (
                <button className="icon-text-button" onClick={() => setEndConfirmOpen(true)} type="button">
                  End
                </button>
              )}
              {playMode === "solo" && (
                <div className="header-menu-wrap">
                  <button
                    className="icon-text-button"
                    type="button"
                    aria-label="Solo options"
                    aria-expanded={soloMenuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSoloMenuOpen((open) => !open);
                    }}
                  >
                    ≡
                  </button>
                  {soloMenuOpen && (
                    <div
                      className="solo-menu"
                      role="menu"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <button type="button" role="menuitem" onClick={() => requestSoloReset("hole")}>
                        Reset current hole
                      </button>
                      <button type="button" role="menuitem" onClick={() => requestSoloReset("scores")}>
                        Reset all scores
                      </button>
                      <button type="button" role="menuitem" onClick={() => requestSoloReset("round")}>
                        Reset round setup
                      </button>
                    </div>
                  )}
                </div>
              )}
            </header>

            <div className="flag-frame" aria-hidden="true">
              <img src={flagImg} alt="" className="flag-img" />
              <span className="flag-hole-number">{activeHole.number}</span>
            </div>

            <section className="card score-card">
              {playMode === "group" && snapshot && (
                <div className="session-row">
                  <span>Code: {snapshot.session.code}</span>
                  <span>Ends in 24h</span>
                </div>
              )}

              {playMode === "group" && (
                <div className="player-chip-row">
                  {players.map((player) => (
                    <button
                      key={player.id}
                      className={`player-chip ${player.id === activePlayerId ? "active" : ""}`}
                      onClick={() => setActivePlayerId(player.id)}
                    >
                      <span>{getInitials(player.name)}</span>
                      <small>{player.name}</small>
                    </button>
                  ))}
                </div>
              )}

              <div className="score-controls">
                <button
                  className="score-button"
                  disabled={loading || (playMode === "group" && !canEditGroupScore)}
                  onClick={() => void handleStrokeChange(-1)}
                >
                  -
                </button>
                <div className="score-value">
                  <strong>{getActiveStroke() ?? ""}</strong>
                  <span>Score</span>
                </div>
                <button
                  className="score-button"
                  disabled={loading || (playMode === "group" && !canEditGroupScore)}
                  onClick={() => void handleStrokeChange(1)}
                >
                  +
                </button>
              </div>

              <div className="hole-nav">
                <button
                  className="secondary-button"
                  disabled={currentHole === 1}
                  onClick={() => setCurrentHole((current) => Math.max(1, current - 1))}
                >
                  Previous Hole
                </button>
                <button
                  className="primary-button"
                  disabled={currentHole === (playMode === "solo" ? soloHoles.length : HOLES.length)}
                  onClick={() =>
                    setCurrentHole((current) =>
                      Math.min(playMode === "solo" ? soloHoles.length : HOLES.length, current + 1)
                    )
                  }
                >
                  Next Hole
                </button>
              </div>
            </section>

            {renderScoreTable()}

          </div>
        )}

        {error && <p className="error-banner">{error}</p>}
        {!isSupabaseConfigured && playMode === "group" && (
          <p className="error-banner">
            Supabase keys are missing. Add them to <code>.env</code> to enable group mode.
          </p>
        )}

        {endConfirmOpen && view === "play" && (
          <div
            className="end-dialog"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (!loading) {
                setEndConfirmOpen(false);
              }
            }}
          >
            <div
              className="end-dialog-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3>End this session?</h3>
              <p>Are you sure you want to end the session for everyone?</p>
              <div className="end-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    if (!loading) {
                      setEndConfirmOpen(false);
                    }
                  }}
                >
                  No, keep playing
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={loading}
                  onClick={() => void executeEndGame()}
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}

        {soloResetConfirmOpen && view === "play" && pendingSoloReset && (
          <div
            className="end-dialog"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setSoloResetConfirmOpen(false);
              setPendingSoloReset(null);
            }}
          >
            <div
              className="end-dialog-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3>
                {pendingSoloReset === "hole"
                  ? `Reset hole ${activeHole.number}?`
                  : pendingSoloReset === "scores"
                    ? "Reset all scores?"
                    : "Reset round setup?"}
              </h3>
              <p>
                {pendingSoloReset === "hole"
                  ? "This clears the entered score for the current hole."
                  : pendingSoloReset === "scores"
                    ? "This clears all entered scores but keeps your hole layout and pars."
                    : "This resets scores, hole count, and pars back to the default 9-hole setup."}
              </p>
              <div className="end-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setSoloResetConfirmOpen(false);
                    setPendingSoloReset(null);
                  }}
                >
                  Cancel
                </button>
                <button className="primary-button" type="button" onClick={executeSoloReset}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {parDialogOpen && view === "play" && parEditHole != null && (
          <div
            className="par-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="par-dialog-title"
            onClick={() => {
              if (!loading) {
                setParDialogOpen(false);
              }
            }}
          >
            <div
              className="end-dialog-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3 id="par-dialog-title">Par for hole {parEditHole}</h3>
              <p className="par-dialog-hint">
                {PAR_MIN}–{PAR_MAX} (long-press par on the course to edit)
              </p>
              <label className="field-label" htmlFor="par-input">
                Par
              </label>
              <input
                id="par-input"
                className="text-input"
                type="number"
                inputMode="numeric"
                min={PAR_MIN}
                max={PAR_MAX}
                value={parDraft}
                onChange={(event) => setParDraft(event.target.value)}
                autoFocus
              />
              <div className="end-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    if (!loading) {
                      setParDialogOpen(false);
                    }
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={loading}
                  onClick={() => void saveParFromDialog()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
