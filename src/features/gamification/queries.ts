import "server-only";
import type { RunnerContext } from "@/features/dashboard/context";
import type { WorkoutRow } from "@/features/workouts/queries";
import { BADGES } from "./logic/badges";
import { challengeProgress } from "./logic/challenges";
import { recoveryCheck } from "./logic/rewards";
import { WEEKLY_GOAL_DAYS } from "./logic/streaks";
import { buildAchievementSummary } from "./logic/summary";
import { localDate, weekStart } from "./logic/time";

/** Achievement summary + weekly challenge progress from persisted records. */
export async function loadGamification(ctx: RunnerContext, completed: WorkoutRow[]) {
  const [ledger, badges] = await Promise.all([
    ctx.supabase.from("xp_ledger").select("delta_xp, delta_coins, reason, award_key, occurred_at"),
    ctx.supabase.from("user_badges").select("badge_code, earned_at"),
  ]);
  if (ledger.error) throw new Error(ledger.error.message);
  if (badges.error) throw new Error(badges.error.message);

  const workouts = completed.map((w) => ({ startedAt: w.startedAt, durationSeconds: w.durationSeconds ?? 0 }));
  const built = buildAchievementSummary({
    userId: ctx.user.id,
    ledger: (ledger.data ?? []).map((r) => ({ deltaXp: r.delta_xp, deltaCoins: r.delta_coins })),
    badges: (badges.data ?? []).map((b) => ({ code: b.badge_code, earnedAt: new Date(b.earned_at).toISOString() })),
    workouts,
    timezone: ctx.timezone,
    today: ctx.today,
  });

  const thisWeek = weekStart(ctx.today);
  const weekWorkouts = completed
    .filter((w) => weekStart(localDate(w.startedAt, ctx.timezone)) === thisWeek)
    .map((w) => ({
      id: w.id,
      workoutType: w.workoutType,
      startedAt: w.startedAt,
      completedAt: w.completedAt!,
      durationSeconds: w.durationSeconds ?? 0,
      distanceMeters: w.distanceMeters,
      programmeSessionId: w.programmeSessionId,
      enrollmentId: w.enrollmentId,
      plannedWorkoutId: w.plannedWorkoutId,
      plannedDate: null,
    }));
  const rewardedDays = (ledger.data ?? [])
    .filter((r) => r.reason === "workout_completed")
    .map((r) => localDate(r.occurred_at, ctx.timezone));
  const weekActiveDays = built.activeDates.filter((d) => weekStart(d) === thisWeek).length;
  const earned = new Set((badges.data ?? []).map((b) => b.badge_code));

  return {
    ...built,
    challenges: challengeProgress(weekWorkouts, ctx.timezone),
    recovery: recoveryCheck(rewardedDays, ctx.today),
    week: { start: thisWeek, activeDays: weekActiveDays, goalDays: WEEKLY_GOAL_DAYS },
    badgeCatalogue: BADGES.map((b) => ({
      ...b,
      earned: earned.has(b.code),
      earnedAt: (badges.data ?? []).find((x) => x.badge_code === b.code)?.earned_at ?? null,
    })),
  };
}

export type LeaderboardRow = { rank: number; displayName: string; xp: number; workouts: number; isMe: boolean };

export async function loadLeaderboard(ctx: RunnerContext, weekStartDate = weekStart(ctx.today)) {
  const [{ data, error }, settings] = await Promise.all([
    ctx.supabase.rpc("weekly_leaderboard", { p_week_start: weekStartDate, p_timezone: ctx.timezone, p_limit: 20 }),
    ctx.supabase.from("runner_settings").select("show_on_leaderboard").eq("user_id", ctx.user.id).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const rows: LeaderboardRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    rank: Number(r.rank),
    displayName: r.display_name as string,
    xp: Number(r.xp),
    workouts: Number(r.workouts),
    isMe: r.is_me as boolean,
  }));
  return { weekStart: weekStartDate, rows, showMe: settings.data?.show_on_leaderboard ?? true };
}
