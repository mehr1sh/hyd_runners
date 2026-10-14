/**
 * Personal report aggregation over persisted workouts. Pure: callers pass
 * completed workouts (any range); this filters to the period by local date.
 */
import type { ReportPeriod, WorkoutType } from "@/lib/contracts";
import { RUN_TYPES } from "@/features/gamification/logic/badges";
import { MIN_ACTIVE_SECONDS, streakSeries } from "@/features/gamification/logic/streaks";
import {
  addDays,
  addMonths,
  dateRange,
  localDate,
  monthStart,
  weekStart,
  yearStart,
  type LocalDate,
} from "@/features/gamification/logic/time";

export type ReportWorkout = {
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  workoutType: WorkoutType;
  planned: boolean;
};

export function periodRange(period: ReportPeriod, anchor: LocalDate, offset = 0) {
  if (period === "week") {
    const start = addDays(weekStart(anchor), offset * 7);
    return { start, end: addDays(start, 6) };
  }
  if (period === "month") {
    const start = addMonths(monthStart(anchor), offset);
    return { start, end: addDays(addMonths(start, 1), -1) };
  }
  const y = Number(yearStart(anchor).slice(0, 4)) + offset;
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildReport(input: {
  period: ReportPeriod;
  range: { start: LocalDate; end: LocalDate };
  workouts: ReportWorkout[];
  allActiveDates: LocalDate[];
  plannedCount: number | null;
  timezone: string;
  today: LocalDate;
}) {
  const { start, end } = input.range;
  const inRange = input.workouts
    .map((w) => ({ ...w, date: localDate(w.startedAt, input.timezone) }))
    .filter((w) => w.date >= start && w.date <= end);

  const activeSeconds = inRange.reduce((s, w) => s + w.durationSeconds, 0);
  const runDistanceMeters = inRange
    .filter((w) => RUN_TYPES.has(w.workoutType))
    .reduce((s, w) => s + (w.distanceMeters ?? 0), 0);
  const activeDays = new Set(inRange.filter((w) => w.durationSeconds >= MIN_ACTIVE_SECONDS).map((w) => w.date));

  const typeMap = new Map<WorkoutType, { count: number; minutes: number }>();
  for (const w of inRange) {
    const t = typeMap.get(w.workoutType) ?? { count: 0, minutes: 0 };
    t.count++;
    t.minutes += Math.round(w.durationSeconds / 60);
    typeMap.set(w.workoutType, t);
  }
  const byType = [...typeMap].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.minutes - a.minutes);

  // Buckets: days for a week, weeks for a month, months for a year.
  type Bucket = { label: string; start: LocalDate; end: LocalDate };
  let buckets: Bucket[];
  if (input.period === "week") {
    buckets = dateRange(start, end).map((d, i) => ({ label: DAYS[i], start: d, end: d }));
  } else if (input.period === "month") {
    buckets = [];
    for (let ws = weekStart(start); ws <= end; ws = addDays(ws, 7)) {
      const s = ws < start ? start : ws;
      const e = addDays(ws, 6) > end ? end : addDays(ws, 6);
      buckets.push({ label: `${Number(s.slice(8))}–${Number(e.slice(8))}`, start: s, end: e });
    }
  } else {
    buckets = MONTHS.map((m, i) => {
      const s = `${start.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`;
      return { label: m, start: s, end: addDays(addMonths(s, 1), -1) };
    });
  }
  const series = buckets.map((b) => {
    const ws = inRange.filter((w) => w.date >= b.start && w.date <= b.end);
    const days = new Set(ws.filter((w) => w.durationSeconds >= MIN_ACTIVE_SECONDS).map((w) => w.date)).size;
    return {
      label: b.label,
      workouts: ws.length,
      minutes: Math.round(ws.reduce((s, w) => s + w.durationSeconds, 0) / 60),
      activeDays: days,
    };
  });

  const elapsedEnd = end < input.today ? end : input.today;
  const elapsedDays = elapsedEnd >= start ? dateRange(start, elapsedEnd).length : 0;
  const streak = elapsedDays ? streakSeries(input.allActiveDates, start, elapsedEnd) : [];

  return {
    period: input.period,
    range: input.range,
    workoutCount: inRange.length,
    activeSeconds,
    runDistanceMeters,
    activeDays: activeDays.size,
    consistency: elapsedDays ? Math.round((activeDays.size / elapsedDays) * 100) : 0,
    planned: {
      planned: input.plannedCount,
      completed: inRange.filter((w) => w.planned).length,
    },
    byType,
    series,
    streakSeries: streak,
    longestStreakInPeriod: streak.reduce((m, p) => Math.max(m, p.streak), 0),
    isEmpty: inRange.length === 0,
  };
}

export type Report = ReturnType<typeof buildReport>;
