/**
 * Programme progress from completed sessions. Order is (week, day); "day"
 * gaps are rest days. Progression is sequential: the next session is the
 * first one not yet completed.
 */
import { addDays, daysBetween, type LocalDate } from "@/features/gamification/logic/time";

export type SessionRef = {
  id: string;
  week: number;
  day: number;
  title: string;
  workoutType: string;
  estimatedMinutes: number;
};

export function programmeProgress(input: {
  sessions: SessionRef[];
  completed: { sessionId: string; localDate: LocalDate }[];
  today: LocalDate;
  durationWeeks: number;
}) {
  const ordered = [...input.sessions].sort((a, b) => a.week - b.week || a.day - b.day);
  const done = new Set(input.completed.map((c) => c.sessionId));
  const completedCount = ordered.filter((s) => done.has(s.id)).length;
  const next = ordered.find((s) => !done.has(s.id)) ?? null;
  const weeks = [...new Set(ordered.map((s) => s.week))];
  const weeksCompleted = weeks.filter((w) => ordered.filter((s) => s.week === w).every((s) => done.has(s.id)));
  const lastDone =
    input.completed
      .map((c) => c.localDate)
      .sort()
      .at(-1) ?? null;

  // At least one rest day between programme sessions: if one was completed
  // today or yesterday, the next is recommended for the day after a rest day.
  let nextRecommendedDate: LocalDate | null = null;
  let restRecommended = false;
  if (next && lastDone) {
    const gap = daysBetween(lastDone, input.today);
    if (gap < 2) {
      restRecommended = true;
      nextRecommendedDate = addDays(lastDone, 2);
    } else nextRecommendedDate = input.today;
  } else if (next) nextRecommendedDate = input.today;

  return {
    total: ordered.length,
    completed: completedCount,
    percent: ordered.length ? Math.round((completedCount / ordered.length) * 100) : 0,
    currentWeek: next?.week ?? input.durationWeeks,
    next,
    upcoming: ordered.filter((s) => !done.has(s.id)).slice(0, 3),
    weeksCompleted,
    finished: ordered.length > 0 && completedCount === ordered.length,
    restRecommended,
    nextRecommendedDate,
    doneSessionIds: done,
  };
}

/** Rest days in a week are the days without a session (e.g. C25K runs on days 1, 3, 5). */
export function restDays(sessionDays: number[]): number[] {
  const set = new Set(sessionDays);
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => !set.has(d));
}
