/**
 * Weekly challenges (Mon–Sun, local). Completing one is recorded once per
 * week and counts toward the "Challenge accepted" badge. Challenges reward
 * consistency and variety, never extra volume.
 */
import { MIN_ACTIVE_SECONDS } from "./streaks";
import { localDate } from "./time";
import type { WorkoutFact } from "./types";

export type ChallengeDef = {
  code: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  progress: (week: WorkoutFact[], timezone: string) => number;
};

const activeDays = (ws: WorkoutFact[], tz: string) =>
  new Set(ws.filter((w) => w.durationSeconds >= MIN_ACTIVE_SECONDS).map((w) => localDate(w.startedAt, tz))).size;

export const CHALLENGES: ChallengeDef[] = [
  {
    code: "three-day-week",
    title: "Three-day week",
    description: "Be active on 3 different days.",
    target: 3,
    unit: "days",
    progress: activeDays,
  },
  {
    code: "sixty-minutes",
    title: "Hour of movement",
    description: "Log 60 active minutes this week.",
    target: 60,
    unit: "min",
    progress: (ws) => Math.floor(ws.reduce((s, w) => s + w.durationSeconds, 0) / 60),
  },
  {
    code: "mix-it-up",
    title: "Mix it up",
    description: "Do two different kinds of activity, e.g. a run and mobility.",
    target: 2,
    unit: "kinds",
    progress: (ws) => new Set(ws.map((w) => (w.workoutType === "walk_run" ? "run" : w.workoutType))).size,
  },
  {
    code: "follow-the-plan",
    title: "Follow the plan",
    description: "Complete 2 programme or planned sessions.",
    target: 2,
    unit: "sessions",
    progress: (ws) => ws.filter((w) => w.programmeSessionId || w.plannedWorkoutId).length,
  },
];

export function challengeProgress(weekWorkouts: WorkoutFact[], timezone: string) {
  return CHALLENGES.map((c) => {
    const value = c.progress(weekWorkouts, timezone);
    return {
      code: c.code,
      title: c.title,
      description: c.description,
      unit: c.unit,
      target: c.target,
      value: Math.min(value, c.target),
      done: value >= c.target,
    };
  });
}
