import "server-only";
import type { RunnerContext } from "./context";
import { listMyActivities, type Activity } from "@/features/activities/queries";
import { listChallenges, type Challenge, type ChallengeProgress } from "@/features/challenges/queries";
import { loadConditions } from "@/features/conditions/server";

export type DashboardExtras = {
  now: number;
  last7: {
    activities: number;
    distanceM: number;
    movingSeconds: number;
    activeDays: number;
  } | null;
  recent: Activity[] | null;
  challenges: { challenge: Challenge; progress: ChallengeProgress }[] | null;
  conditions: Awaited<ReturnType<typeof loadConditions>> | null;
};

/** Settle a promise to null on any error: one failing panel never breaks the dashboard. */
async function soft<T>(name: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    console.error(`[dashboard] ${name} unavailable${code ? ` (${code})` : ""}`);
    return null;
  }
}

/**
 * The Release 2 panels: conditions, the last 7 days of imported activity,
 * recent activities and the runner's live challenges. All read with the
 * runner's own client (RLS), all optional.
 */
export async function loadDashboardExtras(ctx: RunnerContext): Promise<DashboardExtras> {
  const now = Date.now();
  const from = new Date(now - 7 * 86_400_000).toISOString();
  const [summary, recent, challenges, conditions] = await Promise.all([
    soft(
      "my_activity_summary",
      (async () => {
        const { data, error } = await ctx.supabase.rpc("my_activity_summary", {
          p_from: from,
          p_to: new Date(now).toISOString(),
          p_timezone: ctx.timezone,
        });
        if (error) throw error;
        const r = ((data ?? []) as Record<string, unknown>[])[0];
        return r
          ? {
              activities: Number(r.activities),
              distanceM: Number(r.distance_m),
              movingSeconds: Number(r.moving_seconds),
              activeDays: Number(r.active_days),
            }
          : { activities: 0, distanceM: 0, movingSeconds: 0, activeDays: 0 };
      })(),
    ),
    soft(
      "activities",
      listMyActivities(ctx.supabase, ctx.user.id, { type: null, from: null, to: null, before: null }).then((r) =>
        r.activities.filter((a) => a.status === "ready").slice(0, 3),
      ),
    ),
    soft(
      "challenges",
      listChallenges(ctx.supabase, ctx.user.id).then(({ open, progress }) =>
        open
          .filter((c) => progress.get(c.id)?.joined && new Date(c.startsAt).getTime() <= now)
          .slice(0, 3)
          .map((c) => ({ challenge: c, progress: progress.get(c.id)! })),
      ),
    ),
    soft("conditions", loadConditions(ctx.supabase, null)),
  ]);
  return { now, last7: summary, recent, challenges, conditions };
}
