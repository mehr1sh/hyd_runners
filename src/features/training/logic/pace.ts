/**
 * Pace arithmetic for the pace calculator and the workout generator.
 * Seconds per kilometre throughout; miles only at the edges.
 */

export const KM_PER_MILE = 1.609344;

export const paceFrom = (seconds: number, meters: number) => seconds / (meters / 1000);
export const timeFor = (paceS: number, meters: number) => paceS * (meters / 1000);
export const distanceFor = (paceS: number, seconds: number) => (seconds / paceS) * 1000;
export const perMile = (paceSPerKm: number) => paceSPerKm * KM_PER_MILE;
export const perKm = (paceSPerMile: number) => paceSPerMile / KM_PER_MILE;
export const kmh = (paceS: number) => 3600 / paceS;

export type Split = { index: number; meters: number; splitSeconds: number; elapsedSeconds: number; paceS: number };

/**
 * Splits for a race at an even or graded effort. `negativeSplitPct` makes the
 * second half that much faster than the first (0 = even); the total time is
 * unchanged. The last split may be partial.
 */
export function raceSplits(totalSeconds: number, meters: number, splitMeters = 1000, negativeSplitPct = 0): Split[] {
  const avg = paceFrom(totalSeconds, meters);
  // First-half pace p1 and second-half pace p2 with p2 = p1 × (1 − x) and equal halves.
  const x = negativeSplitPct / 100;
  const p1 = (2 * avg) / (2 - x);
  const p2 = p1 * (1 - x);
  const half = meters / 2;
  const splits: Split[] = [];
  let elapsed = 0;
  for (let start = 0, i = 1; start < meters - 0.5; start += splitMeters, i++) {
    const end = Math.min(meters, start + splitMeters);
    const firstPart = Math.max(0, Math.min(end, half) - start);
    const secondPart = end - start - firstPart;
    const secs = timeFor(p1, firstPart) + timeFor(p2, secondPart);
    elapsed += secs;
    splits.push({
      index: i,
      meters: end - start,
      splitSeconds: Math.round(secs),
      elapsedSeconds: Math.round(elapsed),
      paceS: Math.round(paceFrom(secs, end - start)),
    });
  }
  return splits;
}

/** Target time for each repetition of an interval at a pace. */
export function intervalTargets(paceS: number, repMeters: number[]) {
  return repMeters.map((m) => ({ meters: m, seconds: Math.round(timeFor(paceS, m)) }));
}

/** "4:30", "1:02:05", "45" (minutes) → seconds; invalid → null. */
export function parseClock(value: string): number | null {
  const v = value.trim();
  if (/^\d{1,3}$/.test(v)) return Number(v) * 60;
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)$/.exec(v);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  if (m[1] !== undefined && min > 59) return null;
  return h * 3600 + min * 60 + Number(m[3]);
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function clock(totalSeconds: number) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Training paces from a 5K-equivalent time. These are common coaching
 * heuristics (ranges, not prescriptions); with no reference the generator
 * falls back to effort descriptions only.
 */
export type TrainingPaces = {
  recovery: [number, number];
  easy: [number, number];
  long: [number, number];
  tempo: [number, number];
  interval: [number, number];
  /** Where the paces came from, shown with them. */
  basis: string;
};

export function trainingPaces(fiveKSeconds: number, basis: string): TrainingPaces {
  const p = fiveKSeconds / 5;
  const r = (lo: number, hi: number): [number, number] => [Math.round(p * lo), Math.round(p * hi)];
  return {
    recovery: r(1.32, 1.42),
    easy: r(1.2, 1.32),
    long: r(1.2, 1.3),
    tempo: r(1.06, 1.1),
    interval: r(0.98, 1.02),
    basis,
  };
}
