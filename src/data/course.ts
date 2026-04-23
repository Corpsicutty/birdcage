import type { Hole } from "../types";

export const DEFAULT_PAR = 3;
export const HOLE_COUNT = 9;
export const PAR_MIN = 2;
export const PAR_MAX = 6;

/** Fixed 9-hole layout; all holes default to par 3 until edited in-round. */
export const HOLES: Hole[] = [
  { number: 1 },
  { number: 2 },
  { number: 3 },
  { number: 4 },
  { number: 5 },
  { number: 6 },
  { number: 7 },
  { number: 8 },
  { number: 9 }
];

export function defaultHolePars(): number[] {
  return Array.from({ length: HOLE_COUNT }, () => DEFAULT_PAR);
}

export function sumHolePars(pars: number[]): number {
  return pars.reduce((sum, p) => sum + p, 0);
}

function clampPar(value: number): number {
  return Math.min(PAR_MAX, Math.max(PAR_MIN, value));
}

/** Normalizes a par array to length HOLE_COUNT with each value clamped. */
export function normalizeHolePars(raw: unknown): number[] {
  const defaults = defaultHolePars();
  if (!raw) {
    return defaults;
  }
  if (Array.isArray(raw)) {
    return defaults.map((_, i) => {
      const n = Math.floor(Number(raw[i]));
      if (Number.isFinite(n)) {
        return clampPar(n);
      }
      return DEFAULT_PAR;
    });
  }
  return defaults;
}

export function withHoleParReplaced(
  pars: number[],
  holeNumber: number,
  par: number
): number[] {
  const next = [...normalizeHolePars(pars)];
  const i = holeNumber - 1;
  if (i < 0 || i >= next.length) {
    return next;
  }
  next[i] = clampPar(par);
  return next;
}
