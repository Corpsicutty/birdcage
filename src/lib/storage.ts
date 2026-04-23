const PLAYER_TOKEN_KEY = "birdcage-player-token";

export function getOrCreatePlayerToken(): string {
  const existing = window.localStorage.getItem(PLAYER_TOKEN_KEY);
  if (existing) {
    return existing;
  }

  const token = crypto.randomUUID();
  window.localStorage.setItem(PLAYER_TOKEN_KEY, token);
  return token;
}
