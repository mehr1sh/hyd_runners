/**
 * Habit streaks that reward consistency without punishing recovery.
 *
 * Daily ("habit") streak — a run of active days where consecutive active days
 * are at most 2 calendar days apart, i.e. ONE rest day between workouts never
 * breaks the streak. Its length is the number of calendar days from the first
 * to the last active day, rest days included. The streak is still alive while
 * the last active day is today, yesterday or the day before (one rest day).
 *
 * Weekly streak — consecutive ISO weeks (Mon–Sun, local) with at least
 * WEEKLY_GOAL_DAYS active days. The current week never breaks the streak
 * while it is still in progress.
 *
 * An "active day" has at least one completed workout of MIN_ACTIVE_SECONDS.
 */
import { addDays, daysBetween, weekStart, type LocalDate } from "./time";

export const MIN_ACTIVE_SECONDS = 10 * 60;
export const MAX_REST_DAYS_IN_STREAK = 1;
export const WEEKLY_GOAL_DAYS = 3;

export type StreakRun = { start: LocalDate; end: LocalDate; length: number; activeDays: LocalDate[] };

/** Split sorted unique active dates into habit-streak runs. */
export function streakRuns(activeDates: Iterable<LocalDate>): StreakRun[] {
  const dates = [...new Set(activeDates)].sort();
  const runs: StreakRun[] = [];
  for (const d of dates) {
    const last = runs.at(-1);
    if (last && daysBetween(last.end, d) <= MAX_REST_DAYS_IN_STREAK + 1) {
      last.end = d;
      last.activeDays.push(d);
      last.length = daysBetween(last.start, d) + 1;
    } else {
      runs.push({ start: d, end: d, length: 1, activeDays: [d] });
    }
  }
  return runs;
}

export function dailyStreak(activeDates: Iterable<LocalDate>, today: LocalDate) {
  const runs = streakRuns(activeDates);
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  const last = runs.at(-1);
  const alive = !!last && daysBetween(last.end, today) <= MAX_REST_DAYS_IN_STREAK + 1 && last.end <= today;
  const current = alive ? last!.length : 0;
  // At risk: alive, but today is the last chance to keep it going.
  const atRisk = alive && daysBetween(last!.end, today) === MAX_REST_DAYS_IN_STREAK + 1;
  return { current, longest, atRisk, lastActive: last?.end ?? null };
}

/** ISO week starts in which the runner met the weekly goal. */
export function qualifyingWeeks(activeDates: Iterable<LocalDate>): Set<LocalDate> {
  const perWeek = new Map<LocalDate, number>();
  for (const d of new Set(activeDates)) {
    const w = weekStart(d);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  return new Set([...perWeek].filter(([, n]) => n >= WEEKLY_GOAL_DAYS).map(([w]) => w));
}

export type WeeklyRun = { start: LocalDate; end: LocalDate; length: number };

export function weeklyRuns(weeks: Iterable<LocalDate>): WeeklyRun[] {
  const sorted = [...new Set(weeks)].sort();
  const runs: WeeklyRun[] = [];
  for (const w of sorted) {
    const last = runs.at(-1);
    if (last && daysBetween(last.end, w) === 7) {
      last.end = w;
      last.length++;
    } else runs.push({ start: w, end: w, length: 1 });
  }
  return runs;
}

export function weeklyStreak(activeDates: Iterable<LocalDate>, today: LocalDate) {
  const runs = weeklyRuns(qualifyingWeeks(activeDates));
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  const thisWeek = weekStart(today);
  const last = runs.at(-1);
  const alive = !!last && (last.end === thisWeek || last.end === addDays(thisWeek, -7));
  return { current: alive ? last!.length : 0, longest };
}

/** Habit-streak length at the end of each day in [start, end] (for charts). */
export function streakSeries(activeDates: Iterable<LocalDate>, start: LocalDate, end: LocalDate) {
  const runs = streakRuns(activeDates);
  const out: { date: LocalDate; streak: number }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const run = runs.find((r) => r.start <= d && daysBetween(r.end, d) <= MAX_REST_DAYS_IN_STREAK + 1);
    let value = 0;
    if (run) {
      // Rest days keep the value reached on the last active day.
      const lastActiveByD = run.activeDays.filter((a) => a <= d).at(-1)!;
      value = daysBetween(run.start, lastActiveByD) + 1;
    }
    out.push({ date: d, streak: value });
  }
  return out;
}
