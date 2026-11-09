import type { FitnessLevel } from "@/lib/contracts";

/**
 * General return-to-running progression after a break: walk-run intervals
 * that build to continuous easy running over eight weeks, three sessions a
 * week on non-consecutive days. This is general training guidance. It is not
 * an injury-rehabilitation plan; anyone returning from injury should follow
 * their clinician's advice, and it's designed to be reviewed by a coach.
 */

export type ReturnWeek = { week: number; run: number; walk: number; reps: number; note: string };

export const RETURN_WEEKS: ReturnWeek[] = [
  { week: 1, run: 1, walk: 2, reps: 6, note: "Run very easily; walking is part of the plan." },
  { week: 2, run: 2, walk: 2, reps: 5, note: "Repeat week 1 if anything aches the next day." },
  { week: 3, run: 3, walk: 2, reps: 5, note: "" },
  { week: 4, run: 4, walk: 1, reps: 5, note: "An easier week is fine: repeat week 3 if you need to." },
  { week: 5, run: 6, walk: 1, reps: 4, note: "" },
  { week: 6, run: 8, walk: 1, reps: 3, note: "" },
  { week: 7, run: 12, walk: 1, reps: 2, note: "" },
  { week: 8, run: 20, walk: 0, reps: 1, note: "Continuous easy running." },
];

export const RETURN_RULES = [
  "Stop and seek professional advice if you feel pain that changes how you run, or that is worse the next day.",
  "Mild muscle soreness is normal; joint or bone pain is not.",
  "Repeat a week instead of moving on whenever a week felt hard.",
  "Leave at least one rest day between sessions.",
];

export function sessionMinutes(w: ReturnWeek) {
  return 10 + w.reps * (w.run + w.walk);
}

export function sessionTitle(w: ReturnWeek) {
  return w.walk === 0
    ? `Return to running: ${w.run} min easy`
    : `Return to running: ${w.reps} × (${w.run} min run, ${w.walk} min walk)`;
}

/** Weekdays (1–7) for three sessions with a rest day between each. */
export function returnDays(longRunDay = 6): [number, number, number] {
  const a = ((longRunDay - 1 + 7 - 5) % 7) + 1;
  const b = ((longRunDay - 1 + 7 - 3) % 7) + 1;
  return [a, b, longRunDay].sort((x, y) => x - y) as [number, number, number];
}

export function weeksFor(level: FitnessLevel) {
  // Runners who were running regularly before the break may start at week 3.
  return level === "regular" ? RETURN_WEEKS.slice(2) : RETURN_WEEKS;
}
