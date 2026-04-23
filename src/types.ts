export type SessionStatus = "active" | "ended";

export interface SessionRecord {
  id: string;
  code: string;
  created_by_token: string;
  created_at: string;
  expires_at: string;
  status: SessionStatus;
  ended_at: string | null;
  /** One value per hole (length `HOLE_COUNT`); all default to 3 until the session creator edits. */
  hole_pars: number[];
}

export interface PlayerRecord {
  id: string;
  session_id: string;
  name: string;
  claim_token: string | null;
  created_at: string;
}

export interface ScoreRecord {
  id: string;
  session_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
}

export interface Hole {
  number: number;
}
