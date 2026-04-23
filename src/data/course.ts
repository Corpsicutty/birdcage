import type { Hole } from "../types";

export const COURSE_NAME = "Birdcage DGC";

export const HOLES: Hole[] = [
  { number: 1, par: 3, distanceFt: 315 },
  { number: 2, par: 3, distanceFt: 280 },
  { number: 3, par: 4, distanceFt: 452 },
  { number: 4, par: 3, distanceFt: 305 },
  { number: 5, par: 4, distanceFt: 410 },
  { number: 6, par: 4, distanceFt: 430 },
  { number: 7, par: 3, distanceFt: 275 },
  { number: 8, par: 5, distanceFt: 520 },
  { number: 9, par: 3, distanceFt: 295 }
];

export const TOTAL_PAR = HOLES.reduce((sum, hole) => sum + hole.par, 0);
