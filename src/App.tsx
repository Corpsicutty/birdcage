import { useEffect, useMemo, useState } from "react";
import { HOLES, COURSE_NAME, TOTAL_PAR } from "./data/course";
import {
  addPlayer,
  claimPlayer,
  createSession,
  endSession,
  getSessionByCode,
  getSessionSnapshot,
  setScore,
  type SessionSnapshot
} from "./lib/api";
import { getOrCreatePlayerToken } from "./lib/storage";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { PlayerRecord } from "./types";
import flagImg from "../img/flag.png";
import headerImg from "../img/header.png";

type View = "splash" | "group-menu" | "join-session" | "new-session" | "claim-name" | "play";
type PlayMode = "solo" | "group" | null;

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
  const playerToken = useMemo(() => getOrCreatePlayerToken(), []);
  const [view, setView] = useState<View>("splash");
  const [playMode, setPlayMode] = useState<PlayMode>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<SessionSnapshot | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [currentHole, setCurrentHole] = useState(1);

  const [joinCode, setJoinCode] = useState("");
  const [newSessionNames, setNewSessionNames] = useState<string[]>(["", ""]);
  const [newJoinName, setNewJoinName] = useState("");

  const [soloName, setSoloName] = useState("You");
  const [soloScores, setSoloScores] = useState<Record<number, number | null>>({});

  const activeHole = HOLES[currentHole - 1];
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

  function resetToSplash() {
    setView("splash");
    setPlayMode(null);
    setSnapshot(null);
    setPendingSnapshot(null);
    setActivePlayerId(null);
    setCurrentHole(1);
    setError(null);
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
      return sum + (strokes - hole.par);
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
    const base = getActiveStroke() ?? activeHole.par;
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

  async function handleEndGame() {
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

  function renderScoreTable() {
    if (playMode === "solo") {
      const relative = HOLES.reduce((sum, hole) => {
        const strokes = soloScores[hole.number];
        if (strokes == null) {
          return sum;
        }
        return sum + (strokes - hole.par);
      }, 0);

      return (
        <div className="score-table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>HOLE</th>
                <th>PAR</th>
                <th>{soloName || "You"}</th>
              </tr>
            </thead>
            <tbody>
              {HOLES.map((hole) => (
                <tr key={hole.number}>
                  <td>{hole.number}</td>
                  <td>{hole.par}</td>
                  <td>{soloScores[hole.number] ?? "-"}</td>
                </tr>
              ))}
              <tr className="totals-row">
                <td>Front 9</td>
                <td>{TOTAL_PAR}</td>
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
                <td>{hole.par}</td>
                {snapshot.players.map((player) => (
                  <td key={`${hole.number}-${player.id}`}>
                    {getGroupStroke(player.id, hole.number) ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="totals-row">
              <td>Front 9</td>
              <td>{TOTAL_PAR}</td>
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
              <h1>Birdcage</h1>
              <p>Track disc golf rounds solo or with live group scoring.</p>
              <button
                className="primary-button"
                onClick={() => {
                  setPlayMode("solo");
                  setSoloScores({});
                  setCurrentHole(1);
                  setView("play");
                }}
              >
                Play Solo
              </button>
              <button className="secondary-button" onClick={() => setView("group-menu")}>
                Play With Group
              </button>
            </div>
          </div>
        )}

        {view === "group-menu" && (
          <div className="screen simple-screen">
            <h2>Group Session</h2>
            <p>Join an existing code or start a new game for your card.</p>
            <button className="primary-button" onClick={() => setView("join-session")}>
              Join Session
            </button>
            <button className="secondary-button" onClick={() => setView("new-session")}>
              New Session
            </button>
            <button className="ghost-button" onClick={resetToSplash}>
              Back
            </button>
          </div>
        )}

        {view === "join-session" && (
          <div className="screen simple-screen">
            <h2>Join Session</h2>
            <label className="field-label" htmlFor="join-code">
              Session Code
            </label>
            <input
              id="join-code"
              className="text-input uppercase"
              maxLength={6}
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
            />
            <button
              className="primary-button"
              disabled={loading || joinCode.trim().length !== 6}
              onClick={() => void handleJoinSessionLookup()}
            >
              {loading ? "Joining..." : "Continue"}
            </button>
            <button className="ghost-button" onClick={() => setView("group-menu")}>
              Back
            </button>
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
            <button className="primary-button" disabled={loading} onClick={() => void handleCreateSession()}>
              {loading ? "Creating..." : "Create Session"}
            </button>
            <button className="ghost-button" onClick={() => setView("group-menu")}>
              Back
            </button>
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
          <div className="screen play-screen">
            <header className="top-header">
              <button className="icon-text-button" onClick={resetToSplash}>
                &larr;
              </button>
              <div className="header-center">
                <h2>Hole {activeHole.number}</h2>
                <p>
                  Par {activeHole.par} <span>&bull;</span> {activeHole.distanceFt} ft
                </p>
              </div>
              <button className="icon-text-button" onClick={() => void handleEndGame()}>
                End
              </button>
            </header>

            <img src={flagImg} alt="" className="flag-img" />

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
                  <strong>{getActiveStroke() ?? activeHole.par}</strong>
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
            </section>

            {renderScoreTable()}

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
                disabled={currentHole === HOLES.length}
                onClick={() => setCurrentHole((current) => Math.min(HOLES.length, current + 1))}
              >
                Next Hole
              </button>
            </div>

            {playMode === "solo" && (
              <div className="inline-input-row">
                <label className="field-label" htmlFor="solo-name">
                  Name
                </label>
                <input
                  id="solo-name"
                  className="text-input"
                  value={soloName}
                  onChange={(event) => setSoloName(event.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <div className="course-title">{COURSE_NAME}</div>
        {error && <p className="error-banner">{error}</p>}
        {!isSupabaseConfigured && playMode === "group" && (
          <p className="error-banner">
            Supabase keys are missing. Add them to <code>.env</code> to enable group mode.
          </p>
        )}
      </section>
    </main>
  );
}
