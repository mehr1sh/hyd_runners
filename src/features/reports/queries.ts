import "server-only";
import type { ReportPeriod } from "@/lib/contracts";
import type { RunnerContext } from "@/features/dashboard/context";
import { activeDates } from "@/features/gamification/logic/summary";
import { localMidnightUtc, addDays, dateRange } from "@/features/gamification/logic/time";
import { listCompletedWorkouts } from "@/features/workouts/queries";
import { listPlannedWorkouts } from "@/features/workouts/planned-source";
import { buildReport, periodRange } from "./logic/aggregate";

export async function loadReport(ctx: RunnerContext, period: ReportPeriod, offset: number) {
  const range = periodRange(period, ctx.today, offset);
  const [workouts, planned, enrollments, badges] = await Promise.all([
    listCompletedWorkouts(ctx, 5000),
    listPlannedWorkouts(ctx.supabase, ctx.user.id, {
      from: localMidnightUtc(range.start, ctx.timezone),
      to: localMidnightUtc(addDays(range.end, 1), ctx.timezone),
    }),
    ctx.supabase
      .from("enrollments")
      .select("status, started_at, completed_at, programmes(title, sessions_per_week)")
      .eq("user_id", ctx.user.id),
    ctx.supabase.from("user_badges").select("badge_code, earned_at"),
  ]);

  // Planned = scheduled workouts when the planner has them; otherwise the
  // weekly session targets of programmes that were active in the period.
  let plannedCount: number | null = planned.length || null;
  let plannedSource: "schedule" | "programme" | null = planned.length ? "schedule" : null;
  if (!plannedCount) {
    const days = dateRange(range.start, range.end < ctx.today ? range.end : ctx.today).length;
    const weeks = days / 7;
    const target = (enrollments.data ?? [])
      .filter((e) => ["active", "completed"].includes(e.status) && e.started_at)
      .reduce(
        (s, e) => s + ((e.programmes as unknown as { sessions_per_week: number } | null)?.sessions_per_week ?? 0),
        0,
      );
    if (target && days > 0) {
      plannedCount = Math.round(target * weeks);
      plannedSource = "programme";
    }
  }

  const report = buildReport({
    period,
    range,
    workouts: workouts.map((w) => ({
      startedAt: w.startedAt,
      durationSeconds: w.durationSeconds ?? 0,
      distanceMeters: w.distanceMeters,
      workoutType: w.workoutType,
      planned: !!(w.programmeSessionId || w.plannedWorkoutId),
    })),
    allActiveDates: activeDates(
      workouts.map((w) => ({ startedAt: w.startedAt, durationSeconds: w.durationSeconds ?? 0 })),
      ctx.timezone,
    ),
    plannedCount,
    timezone: ctx.timezone,
    today: ctx.today,
  });

  const badgesInPeriod = (badges.data ?? []).filter((b) => {
    const d = new Date(b.earned_at).toISOString();
    return (
      d >= localMidnightUtc(range.start, ctx.timezone).toISOString() &&
      d < localMidnightUtc(addDays(range.end, 1), ctx.timezone).toISOString()
    );
  });

  return { report, plannedSource, badgesInPeriod: badgesInPeriod.map((b) => b.badge_code) };
}
