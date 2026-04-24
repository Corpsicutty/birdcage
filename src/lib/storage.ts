const PLAYER_TOKEN_KEY = "birdcage-player-token";
const ACTIVE_GROUP_KEY = "birdcage-active-group";
const SOLO_SESSION_KEY = "birdcage-solo-session";

export function getOrCreatePlayerToken(): string {
  const existing = window.localStorage.getItem(PLAYER_TOKEN_KEY);
  if (existing) {
    return existing;
  }

  const token = crypto.randomUUID();
  window.localStorage.setItem(PLAYER_TOKEN_KEY, token);
  return token;
}

export type ActiveGroupSessionV1 = {
  v: 1;
  sessionId: string;
  code: string;
  playerId: string;
  lastHole: number;
};

function parseActiveGroup(value: string | null): ActiveGroupSessionV1 | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as ActiveGroupSessionV1;
  } catch {
    return null;
  }
}

export function readActiveGroupSession(): ActiveGroupSessionV1 | null {
  return parseActiveGroup(window.localStorage.getItem(ACTIVE_GROUP_KEY));
}

export function writeActiveGroupSession(data: ActiveGroupSessionV1) {
  window.localStorage.setItem(ACTIVE_GROUP_KEY, JSON.stringify(data));
}

export function clearActiveGroupSession() {
  window.localStorage.removeItem(ACTIVE_GROUP_KEY);
}

export type SoloSessionV1 = {
  v: 1;
  name: string;
  scores: Record<number, number | null>;
  holePars: number[];
  lastHole: number;
};

function parseSoloSession(value: string | null): SoloSessionV1 | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as SoloSessionV1;
    if (parsed?.v !== 1 || !Array.isArray(parsed.holePars) || typeof parsed.lastHole !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readSoloSession(): SoloSessionV1 | null {
  return parseSoloSession(window.localStorage.getItem(SOLO_SESSION_KEY));
}

export function writeSoloSession(data: SoloSessionV1) {
  window.localStorage.setItem(SOLO_SESSION_KEY, JSON.stringify(data));
}

export function clearSoloSession() {
  window.localStorage.removeItem(SOLO_SESSION_KEY);
}
