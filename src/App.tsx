import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PAR,
  HOLE_COUNT,
  HOLES,
  PAR_MAX,
  PAR_MIN,
  defaultHolePars,
  normalizeHolePars,
  sumHolePars,
  withHoleParReplaced
} from "./data/course";
import {
  addPlayer,
  appendHolesToSession,
  claimPlayer,
  clearAllScoresInGroupSession,
  clearStrokesOnHoleForSession,
  createSession,
  endSession,
  getSessionByCode,
  getSessionSnapshot,
  removeHoleFromGroupSession,
  resetGroupSessionRoundToFrontNine,
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
import { createUuid } from "./lib/id";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { PlayerRecord, ScoreRecord } from "./types";
import flagImg from "../img/flag.png";
import headerImg from "../img/arched-header.png";
import buyMeCoffeeIcon from "../img/buy-me-coffee-icon.png";
import brandLogoImg from "../img/Birdcage-Logo-Smaller.png";
import soloModeImg from "../img/solo.png";
import groupModeImg from "../img/group.png";

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

type SoloInitState = {
  name: string;
  scores: Record<number, number | null>;
  holePars: number[];
  lastHole: number;
};

/**
 * On cold load, keep solo rounds to the front 9 only so the UI stays simple.
 * Extra holes and scores for holes 10+ are not restored (user can add more with +).
 */
function buildInitialSoloState(): SoloInitState {
  const stored = readSoloSession();
  if (!stored) {
    return {
      name: "",
      scores: {},
      holePars: defaultHolePars(),
      lastHole: 1
    };
  }

  const sourcePars = Array.isArray(stored.holePars) ? stored.holePars : defaultHolePars();
  const headPars = sourcePars.length > HOLE_COUNT ? sourcePars.slice(0, HOLE_COUNT) : sourcePars;
  const holePars = normalizeHolePars(headPars);

  const scores: Record<number, number | null> = {};
  for (let hole = 1; hole <= HOLE_COUNT; hole += 1) {
    if (Object.prototype.hasOwnProperty.call(stored.scores, hole)) {
      scores[hole] = stored.scores[hole] ?? null;
    }
  }

  const lastHole = Math.min(
    Math.max(1, stored.lastHole),
    Math.max(1, holePars.length)
  );

  return {
    name: stored.name,
    scores,
    holePars,
    lastHole
  };
}

/** Local mirror of server state after removing a back hole (must match `removeHoleFromGroupSession`). */
function snapshotAfterRemovingGroupHole(
  current: SessionSnapshot,
  holeNumber: number
): SessionSnapshot {
  if (holeNumber <= 9 || holeNumber > current.session.hole_pars.length) {
    return current;
  }
  const newPars = current.session.hole_pars.filter((_, i) => i !== holeNumber - 1);
  const scores: ScoreRecord[] = current.scores
    .filter((s) => s.hole_number !== holeNumber)
    .map((s) =>
      s.hole_number > holeNumber
        ? { ...s, hole_number: s.hole_number - 1 }
        : s
    );
  return {
    ...current,
    session: { ...current.session, hole_pars: newPars },
    scores
  };
}

function PlayHelpDialogContent({ playMode }: { playMode: "solo" | "group" }) {
  return (
    <div className="play-help-body">
      {playMode === "solo" ? (
        <>
          <section className="play-help-section">
            <h3 className="play-help-heading">Scoring</h3>
            <p>
              Use the <strong>−</strong> and <strong>+</strong> buttons under the flag to add or remove
              strokes for the <strong>current hole</strong> (scores stay between 1 and 20). The large number
              is your score for that hole.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Move between holes</h3>
            <p>
              Use <strong>Previous hole</strong> and <strong>Next hole</strong>, or scroll the scorecard
              to jump around the round.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Par</h3>
            <p>
              Tap <strong>Par</strong> in the header, or tap any <strong>par</strong> cell in the
              scorecard, to set par for that hole (valid range is shown in the editor).
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Add or remove holes</h3>
            <p>
              On the <strong>Front 9</strong> total row, tap <strong>+</strong> to add nine more holes
              (back nine). At the bottom of the list, use <strong>+</strong> on the &quot;next hole&quot;
              row to add a single hole. For holes <strong>10 and up</strong>, use <strong>−</strong> next
              to the hole number to remove that hole and its scores.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Menu (≡)</h3>
            <p>
              Open the <strong>≡</strong> menu to reset the <strong>current hole</strong>, clear{" "}
              <strong>all scores</strong>, or reset the <strong>full round</strong> (back to a 9-hole
              layout and default pars).
            </p>
          </section>
        </>
      ) : (
        <>
          <section className="play-help-section">
            <h3 className="play-help-heading">Session admin</h3>
            <p>
              The person who <strong>created the session</strong> (the <strong>first name</strong> in the
              list when the host set up the game) is the <strong>admin</strong>. The admin can change{" "}
              <strong>pars</strong>, <strong>add or remove holes</strong>, and use the <strong>group menu</strong>{" "}
              (≡) for whole-session resets. Other players only change scores for the player they{" "}
              <strong>claimed</strong> when they joined.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Joining and players</h3>
            <p>
              Share the <strong>session code</strong> from the play screen. New players choose{" "}
              <strong>Join session</strong>, enter the code, then <strong>claim</strong> an open name or{" "}
              <strong>add</strong> a new one. The host creates the session with at least two names; more
              people can join at any time while the session is active.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Scoring</h3>
            <p>
              Tap a <strong>player chip</strong> to select who you are editing. You can only enter scores
              for <strong>your</strong> claimed player. Use <strong>−</strong> and <strong>+</strong> to
              change strokes for the <strong>current hole</strong>; everyone sees updates live.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Par and holes (admin)</h3>
            <p>
              The admin can tap <strong>Par</strong> in the header or any <strong>par</strong> in the table
              to edit. Use <strong>+</strong> on the <strong>Front 9</strong> row for nine more holes, or the
              bottom <strong>+</strong> row to add one hole. Use <strong>−</strong> on hole numbers 10+ to
              remove a back hole. Non-admins see the same card but cannot edit layout or pars.
            </p>
          </section>
          <section className="play-help-section">
            <h3 className="play-help-heading">Group menu and End</h3>
            <p>
              <strong>≡</strong> (admin only): reset the <strong>current hole</strong> for all players,
              clear <strong>all scores</strong>, or reset the <strong>round setup</strong> for everyone.{" "}
              <strong>End</strong> ends the session for the whole group.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default function App() {
  const soloInit = useMemo(() => buildInitialSoloState(), []);
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
  const [currentHole, setCurrentHole] = useState(() => soloInit.lastHole);

  const [joinCode, setJoinCode] = useState("");
  const [newSessionNames, setNewSessionNames] = useState<string[]>(["", ""]);
  const [newJoinName, setNewJoinName] = useState("");

  const [soloName, setSoloName] = useState(() => soloInit.name);
  const [soloScores, setSoloScores] = useState<Record<number, number | null>>(() => soloInit.scores);
  const [soloHolePars, setSoloHolePars] = useState(() => soloInit.holePars);

  const [parDialogOpen, setParDialogOpen] = useState(false);
  const [parEditHole, setParEditHole] = useState<number | null>(null);
  const [parDraft, setParDraft] = useState(String(DEFAULT_PAR));
  const [soloMenuOpen, setSoloMenuOpen] = useState(false);
  const [soloResetConfirmOpen, setSoloResetConfirmOpen] = useState(false);
  const [pendingSoloReset, setPendingSoloReset] = useState<SoloResetAction | null>(null);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [groupResetConfirmOpen, setGroupResetConfirmOpen] = useState(false);
  const [pendingGroupReset, setPendingGroupReset] = useState<SoloResetAction | null>(null);
  const [splashInfoOpen, setSplashInfoOpen] = useState(false);
  const [playHelpOpen, setPlayHelpOpen] = useState(false);

  const suppressGroupSessionRealtimeRef = useRef(false);

  const soloHoles = useMemo(
    () => Array.from({ length: soloHolePars.length }, (_, index) => ({ number: index + 1 })),
    [soloHolePars.length]
  );

  const groupHoles = useMemo(() => {
    if (playMode !== "group" || !snapshot) {
      return [];
    }
    const n = snapshot.session.hole_pars.length;
    return Array.from({ length: n }, (_, index) => ({ number: index + 1 }));
  }, [playMode, snapshot?.session.hole_pars, snapshot?.session.id]);

  const activeHole =
    playMode === "solo"
      ? soloHoles[currentHole - 1] ?? { number: 1 }
      : playMode === "group" && groupHoles.length > 0
        ? groupHoles[currentHole - 1] ?? { number: 1 }
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
  const groupSessionLive =
    playMode === "group" &&
    !!snapshot &&
    snapshot.session.status === "active" &&
    new Date(snapshot.session.expires_at).getTime() > Date.now();
  const canEditGroupLayout = isSessionCreator && groupSessionLive;
  const canEditPar = playMode === "solo" || isSessionCreator;
  const playHoleCount =
    playMode === "solo"
      ? soloHoles.length
      : playMode === "group" && snapshot
        ? snapshot.session.hole_pars.length
        : HOLES.length;

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

  function openParDialog(holeNumber: number) {
    if (playMode === "solo") {
      // allow
    } else if (playMode === "group" && snapshot && snapshot.session.created_by_token === playerToken) {
      // allow
    } else {
      return;
    }
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
    setGroupMenuOpen(false);
    setGroupResetConfirmOpen(false);
    setPendingGroupReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    setSplashInfoOpen(false);
    setPlayHelpOpen(false);
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
    setGroupMenuOpen(false);
    setGroupResetConfirmOpen(false);
    setPendingGroupReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    setSplashInfoOpen(false);
    setPlayHelpOpen(false);
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
    setGroupMenuOpen(false);
    setGroupResetConfirmOpen(false);
    setPendingGroupReset(null);
    setParDialogOpen(false);
    setParEditHole(null);
    setSplashInfoOpen(false);
    setPlayHelpOpen(false);

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
    if (playMode !== "solo") {
      return;
    }
    const maxHole = Math.max(1, soloHolePars.length);
    const safeLastHole = Math.min(Math.max(1, currentHole), maxHole);
    writeSoloSession({
      v: 1,
      name: soloName,
      scores: soloScores,
      holePars: soloHolePars,
      lastHole: safeLastHole
    });
  }, [playMode, soloName, soloScores, soloHolePars, currentHole]);

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

  useEffect(() => {
    if (playMode !== "group" || !snapshot) {
      return;
    }
    const maxH = Math.max(1, snapshot.session.hole_pars.length);
    setCurrentHole((c) => Math.max(1, Math.min(c, maxH)));
  }, [playMode, snapshot?.session.hole_pars.length, snapshot?.session.id]);

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
          next.session.hole_pars.length
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
          if (suppressGroupSessionRealtimeRef.current) {
            return;
          }
          void refreshSnapshot(sessionId);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `session_id=eq.${sessionId}` },
        () => {
          if (suppressGroupSessionRealtimeRef.current) {
            return;
          }
          void refreshSnapshot(sessionId);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
        () => {
          if (suppressGroupSessionRealtimeRef.current) {
            return;
          }
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

    const n = snapshot.session.hole_pars.length;
    let sum = 0;
    for (let holeNumber = 1; holeNumber <= n; holeNumber += 1) {
      const strokes = getGroupStroke(player.id, holeNumber);
      if (strokes == null) {
        continue;
      }
      const par = snapshot.session.hole_pars[holeNumber - 1] ?? DEFAULT_PAR;
      sum += strokes - par;
    }
    return sum;
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
              id: createUuid(),
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

  function requestGroupReset(action: SoloResetAction) {
    if (!canEditGroupLayout) {
      return;
    }
    setGroupMenuOpen(false);
    setPendingGroupReset(action);
    setGroupResetConfirmOpen(true);
  }

  async function executeGroupReset() {
    if (!pendingGroupReset || !snapshot || !canEditGroupLayout) {
      return;
    }
    setLoading(true);
    setError(null);
    const sessionId = snapshot.session.id;
    try {
      if (pendingGroupReset === "hole") {
        await clearStrokesOnHoleForSession(sessionId, activeHole.number);
        setGroupResetConfirmOpen(false);
        setPendingGroupReset(null);
        await refreshSnapshot(sessionId);
        return;
      }
      if (pendingGroupReset === "scores") {
        await clearAllScoresInGroupSession(sessionId);
        setGroupResetConfirmOpen(false);
        setPendingGroupReset(null);
        await refreshSnapshot(sessionId);
        return;
      }
      await resetGroupSessionRoundToFrontNine(sessionId);
      setGroupResetConfirmOpen(false);
      setPendingGroupReset(null);
      setCurrentHole(1);
      await refreshSnapshot(sessionId);
    } catch (groupResetError) {
      setError(
        groupResetError instanceof Error ? groupResetError.message : "Unable to reset the group round."
      );
      await refreshSnapshot(sessionId);
    } finally {
      setLoading(false);
    }
  }

  async function expandGroupToBackNine() {
    if (!snapshot || !canEditGroupLayout) {
      return;
    }
    setLoading(true);
    setError(null);
    const sessionId = snapshot.session.id;
    try {
      await appendHolesToSession(
        sessionId,
        Array.from({ length: 9 }, () => DEFAULT_PAR)
      );
      await refreshSnapshot(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add holes.");
      await refreshSnapshot(sessionId);
    } finally {
      setLoading(false);
    }
  }

  async function addGroupSingleHole() {
    if (!snapshot || !canEditGroupLayout) {
      return;
    }
    setLoading(true);
    setError(null);
    const sessionId = snapshot.session.id;
    try {
      await appendHolesToSession(sessionId, [DEFAULT_PAR]);
      await refreshSnapshot(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add a hole.");
      await refreshSnapshot(sessionId);
    } finally {
      setLoading(false);
    }
  }

  async function removeGroupBackHole(holeNumber: number) {
    if (!snapshot || !canEditGroupLayout) {
      return;
    }
    if (holeNumber <= 9 || holeNumber > snapshot.session.hole_pars.length) {
      return;
    }
    const sessionId = snapshot.session.id;
    const afterLen = snapshot.session.hole_pars.length - 1;
    setError(null);
    suppressGroupSessionRealtimeRef.current = true;
    setSnapshot((s) => (s ? snapshotAfterRemovingGroupHole(s, holeNumber) : s));
    setCurrentHole((c) => {
      if (c > holeNumber) {
        return c - 1;
      }
      return Math.max(1, Math.min(c, afterLen));
    });
    try {
      await removeHoleFromGroupSession(sessionId, holeNumber);
      await refreshSnapshot(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to remove a hole.");
      await refreshSnapshot(sessionId);
    } finally {
      suppressGroupSessionRealtimeRef.current = false;
    }
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
                    onClick={canEditPar ? () => openParDialog(hole.number) : undefined}
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
                    onClick={canEditPar ? () => openParDialog(hole.number) : undefined}
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

    function relForHolesOnPlayer(player: PlayerRecord, holes: { number: number }[]) {
      return holes.reduce((sum, h) => {
        const s = getGroupStroke(player.id, h.number);
        if (s == null) {
          return sum;
        }
        return sum + (s - parForHole(h.number));
      }, 0);
    }

    const frontHolesG = groupHoles.filter((h) => h.number <= 9);
    const backHolesG = groupHoles.filter((h) => h.number > 9);
    const backSummaryLabelG =
      backHolesG.length > 0 ? (backHolesG.length <= 9 ? "Back 9" : `Back ${backHolesG.length}`) : "";
    const frontParTotalG = frontHolesG.reduce((sum, h) => sum + parForHole(h.number), 0);
    const backParTotalG = backHolesG.reduce((sum, h) => sum + parForHole(h.number), 0);

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
            {frontHolesG.map((hole) => (
              <tr key={hole.number}>
                <td className="solo-hole-cell">
                  <div className="hole-number-cell-content">
                    <span className="hole-symbol-slot" aria-hidden="true" />
                    <span className="hole-number-value">{hole.number}</span>
                  </div>
                </td>
                <td
                  className={canEditPar ? "par-cell par-cell--editable" : "par-cell"}
                  onClick={canEditPar ? () => openParDialog(hole.number) : undefined}
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
              <td>
                <div className="totals-label-wrap hole-number-cell-content">
                  <span className="hole-symbol-slot">
                    {canEditGroupLayout && (
                      <button
                        className="expand-holes-button"
                        type="button"
                        onClick={() => {
                          void expandGroupToBackNine();
                        }}
                        aria-label="Add nine more holes"
                      >
                        +
                      </button>
                    )}
                  </span>
                  <span className="hole-number-value">Front 9</span>
                </div>
              </td>
              <td>{frontParTotalG}</td>
              {snapshot.players.map((player) => (
                <td key={`front9-${player.id}`}>{formatRelative(relForHolesOnPlayer(player, frontHolesG))}</td>
              ))}
            </tr>
            {backHolesG.map((hole) => (
              <tr key={hole.number}>
                <td
                  className={
                    hole.number > 9
                      ? "solo-hole-cell solo-hole-cell--deletable"
                      : "solo-hole-cell"
                  }
                >
                  <div className="hole-number-cell-content">
                    <span className="hole-symbol-slot">
                      {hole.number > 9 && canEditGroupLayout && (
                        <button
                          className="solo-hole-delete"
                          type="button"
                          onClick={() => {
                            void removeGroupBackHole(hole.number);
                          }}
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
                  onClick={canEditPar ? () => openParDialog(hole.number) : undefined}
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
            {canEditGroupLayout && (
              <tr className="hole-add-row">
                <td className="solo-hole-cell">
                  <div className="hole-number-cell-content">
                    <span className="hole-symbol-slot">
                      <button
                        className="expand-holes-button"
                        type="button"
                        onClick={() => {
                          void addGroupSingleHole();
                        }}
                        aria-label="Add one hole"
                      >
                        +
                      </button>
                    </span>
                    <span className="hole-number-value">{snapshot.session.hole_pars.length + 1}</span>
                  </div>
                </td>
                <td>-</td>
                {snapshot.players.map((player) => (
                  <td key={`add-${player.id}`}>-</td>
                ))}
              </tr>
            )}
            {backHolesG.length > 0 && (
              <tr className="totals-row">
                <td>{backSummaryLabelG}</td>
                <td>{backParTotalG}</td>
                {snapshot.players.map((player) => (
                  <td key={`backtot-${player.id}`}>{formatRelative(relForHolesOnPlayer(player, backHolesG))}</td>
                ))}
              </tr>
            )}
            <tr className="totals-row">
              <td>Total</td>
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
              <img src={brandLogoImg} alt="Birdcage" className="brand-logo" />
              <div className="splash-actions">
                <button
                  className="splash-mode-button"
                  onClick={() => {
                    setPlayMode("solo");
                    const maxHole = Math.max(1, soloHolePars.length);
                    setCurrentHole((current) => Math.min(Math.max(1, current), maxHole));
                    setView("play");
                  }}
                >
                  <img
                    src={soloModeImg}
                    alt="Play solo"
                    className="splash-mode-image"
                  />
                  <span className="splash-mode-subtext">Play on your own and track your round.</span>
                </button>
                <button
                  className="splash-mode-button"
                  onClick={() => {
                    setView("group-menu");
                  }}
                >
                  <img
                    src={groupModeImg}
                    alt="Play with group"
                    className="splash-mode-image"
                  />
                  <span className="splash-mode-subtext">
                    Start or join a shared session with live score updates.
                  </span>
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
              <div className="splash-info-block">
                <button
                  type="button"
                  className="splash-info-toggle"
                  onClick={() => setSplashInfoOpen((open) => !open)}
                  aria-expanded={splashInfoOpen}
                  aria-controls="splash-intro-panel"
                  id="splash-info-button"
                >
                  <span className="splash-info-icon" aria-hidden="true">
                    i
                  </span>
                  <span className="visually-hidden">
                    {splashInfoOpen ? "Hide" : "Show"} how Birdcage works
                  </span>
                </button>
                {splashInfoOpen && (
                  <div
                    className="splash-intro"
                    id="splash-intro-panel"
                    role="region"
                    aria-labelledby="splash-info-button"
                  >
                    <p className="splash-intro__text">
                      <strong>Join an existing game session or generate a new one.</strong> Your friends will
                      be able to join the session and keep their own score while they play. All the scores
                      will update live for all players to see.
                    </p>
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
              if (groupMenuOpen) {
                setGroupMenuOpen(false);
              }
              if (playHelpOpen) {
                setPlayHelpOpen(false);
              }
            }}
          >
            <header
              className={
                view === "play" && playMode ? "top-header top-header--play-tools" : "top-header"
              }
            >
              <button className="icon-text-button" onClick={returnToMenuFromPlay} type="button">
                &larr;
              </button>
              <div className="header-center">
                <h2>Hole {activeHole.number}</h2>
                <p className="hole-meta">
                  {canEditPar ? (
                    <button
                      type="button"
                      className="par-tap"
                      onClick={() => openParDialog(currentHole)}
                    >
                      Par {activePar}
                    </button>
                  ) : (
                    <span>Par {activePar}</span>
                  )}
                </p>
              </div>
              {playMode === "group" && (
                <div className="header-right-cluster">
                  <button
                    type="button"
                    className="play-help-icon"
                    aria-label="How to use Birdcage"
                    aria-expanded={playHelpOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSoloMenuOpen(false);
                      setGroupMenuOpen(false);
                      setPlayHelpOpen((open) => !open);
                    }}
                  >
                    <span className="play-help-icon-glyph" aria-hidden="true">
                      i
                    </span>
                  </button>
                  {isSessionCreator && canEditGroupLayout && (
                    <div className="header-menu-wrap">
                      <button
                        className="icon-text-button"
                        type="button"
                        aria-label="Group options"
                        aria-expanded={groupMenuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setGroupMenuOpen((open) => !open);
                        }}
                      >
                        ≡
                      </button>
                      {groupMenuOpen && (
                        <div
                          className="solo-menu"
                          role="menu"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => requestGroupReset("hole")}
                          >
                            Reset current hole
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => requestGroupReset("scores")}
                          >
                            Reset all scores
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => requestGroupReset("round")}
                          >
                            Reset round setup
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <button className="icon-text-button" onClick={() => setEndConfirmOpen(true)} type="button">
                    End
                  </button>
                </div>
              )}
              {playMode === "solo" && (
                <div className="header-right-cluster">
                  <button
                    type="button"
                    className="play-help-icon"
                    aria-label="How to use Birdcage"
                    aria-expanded={playHelpOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSoloMenuOpen(false);
                      setGroupMenuOpen(false);
                      setPlayHelpOpen((open) => !open);
                    }}
                  >
                    <span className="play-help-icon-glyph" aria-hidden="true">
                      i
                    </span>
                  </button>
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
                  disabled={currentHole === playHoleCount}
                  onClick={() =>
                    setCurrentHole((current) => Math.min(playHoleCount, current + 1))
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

        {groupResetConfirmOpen && view === "play" && playMode === "group" && pendingGroupReset && (
          <div
            className="end-dialog"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setGroupResetConfirmOpen(false);
              setPendingGroupReset(null);
            }}
          >
            <div
              className="end-dialog-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3>
                {pendingGroupReset === "hole"
                  ? `Reset hole ${activeHole.number} for all players?`
                  : pendingGroupReset === "scores"
                    ? "Reset all players’ scores?"
                    : "Reset round setup for the session?"}
              </h3>
              <p>
                {pendingGroupReset === "hole"
                  ? "This clears every player’s score on the current hole."
                  : pendingGroupReset === "scores"
                    ? "This clears all entered scores for every player, but keeps the hole layout and pars."
                    : "This removes all scores, resets the layout to 9 front holes, and default pars, for all players in this session."}
              </p>
              <div className="end-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setGroupResetConfirmOpen(false);
                    setPendingGroupReset(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    void executeGroupReset();
                  }}
                >
                  Reset
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
                {PAR_MIN}–{PAR_MAX} (tap a par in the table or above to edit)
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

        {playHelpOpen && view === "play" && (playMode === "solo" || playMode === "group") && (
          <div
            className="end-dialog play-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="play-help-title"
            onClick={() => {
              setPlayHelpOpen(false);
            }}
          >
            <div
              className="end-dialog-card play-help-card"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <h3 id="play-help-title">How to use Birdcage</h3>
              <PlayHelpDialogContent playMode={playMode} />
              <div className="end-dialog-actions play-help-actions">
                <button className="primary-button" type="button" onClick={() => setPlayHelpOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
