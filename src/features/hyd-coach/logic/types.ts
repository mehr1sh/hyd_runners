import type { Effort, RaceKey } from "@/features/training/logic/predict";
import type { LocalDate } from "@/features/gamification/logic/time";
import type { Intent } from "./intent";

/** One week of running (run and walk-run activities), Monday start, local time. */
export type WeekRow = { weekStart: LocalDate; distanceM: number; runs: number; movingS: number; activeDays: number };

export type RecentRun = {
  id: string;
  localDate: LocalDate;
  distanceM: number;
  movingS: number;
  avgPaceS: number | null;
  name: string | null;
};

/**
 * Everything the coach may use, retrieved with the runner's own session (RLS
 * applies, so it can only ever contain the caller's data). Nothing here is
 * sent to an AI provider except as rendered facts.
 */
export type CoachData = {
  today: LocalDate;
  nowMs: number;
  /** 13 weeks, oldest first; the last entry is the current, unfinished week. */
  weeks: WeekRow[];
  /** Run and walk-run activities from the last 120 days, newest first. */
  runs: RecentRun[];
  efforts: Effort[];
  plan: {
    upcoming: { title: string; workoutType: string; startsAt: string; durationMinutes: number }[];
    past28: { planned: number; completed: number; missed: number };
  };
  prefs: { goal: string; sessionsPerWeek: number } | null;
  conditions: { place: string; summary: string; nowLevel: string | null } | null;
  raceGoal: { distance: RaceKey; date: LocalDate; targetSeconds: number | null; name: string | null } | null;
  recovery: { date: LocalDate; fatigue: number | null; soreness: number | null; sleepQuality: number | null }[];
};

export type Fact = { id: string; label: string; value: string; href?: string };

export type CoachAnswer = {
  intent: Intent;
  /** Paragraphs separated by blank lines. Every number in it comes from `basis`. */
  text: string;
  recommendation: string | null;
  basis: Fact[];
  missing: string[];
  uncertainty: string | null;
  links: { href: string; label: string }[];
  /** Local date of the newest activity the answer could see. */
  dataAsOf: LocalDate | null;
};
