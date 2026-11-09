import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { addDays, localDate, localMidnightUtc, weekStart } from "@/features/gamification/logic/time";
import { callerTimezone } from "@/features/scheduler/server/data";
import { loadConditions } from "@/features/conditions/server";
import type { PrKey } from "@/features/activities/logic/normalize";
import type { Intent } from "../logic/intent";
import type { CoachData, WeekRow } from "../logic/types";

function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

/**
 * Retrieves the runner's coaching context with their own session. Every query
 * is filtered to the caller by RLS (and by `user_id` where the table allows
 * shared rows), so another runner's data can never be loaded here. Weather is
 * fetched only for questions about today.
 */
export async function loadCoachData(supabase: SupabaseClient, userId: string, intent: Intent): Promise<CoachData> {
  const timezone = await callerTimezone(supabase, userId);
  const nowMs = Date.now();
  const today = localDate(new Date(nowMs), timezone);
  const firstWeek = addDays(weekStart(today), -7 * 12);
  const tomorrowTs = localMidnightUtc(addDays(today, 1), timezone).toISOString();
  const since120 = localMidnightUtc(addDays(today, -119), timezone).toISOString();
  const past28 = localMidnightUtc(addDays(today, -28), timezone).toISOString();
  const todayTs = localMidnightUtc(today, timezone).toISOString();
  const in14 = localMidnightUtc(addDays(today, 15), timezone).toISOString();

  const [weekly, runs, efforts, upcoming, pastPlan, prefs, conditions] = await Promise.all([
    supabase.rpc("my_weekly_series", {
      p_from: localMidnightUtc(firstWeek, timezone).toISOString(),
      p_to: tomorrowTs,
      p_timezone: timezone,
      p_types: ["run", "walk_run"],
    }),
    supabase
      .from("activities")
      .select("id, name, started_at, distance_m, moving_seconds, avg_pace_s")
      .eq("user_id", userId)
      .eq("status", "ready")
      .in("activity_type", ["run", "walk_run"])
      .gte("started_at", since120)
      .lt("started_at", tomorrowTs)
      .order("started_at", { ascending: false })
      .limit(400),
    supabase.rpc("my_best_efforts"),
    supabase
      .from("scheduled_workouts")
      .select("title, workout_type, starts_at, duration_minutes")
      .eq("user_id", userId)
      .eq("status", "planned")
      .gte("starts_at", todayTs)
      .lt("starts_at", in14)
      .order("starts_at")
      .limit(20),
    supabase
      .from("scheduled_workouts")
      .select("status")
      .eq("user_id", userId)
      .neq("status", "rescheduled")
      .gte("starts_at", past28)
      .lt("starts_at", todayTs)
      .limit(200),
    supabase.from("user_preferences").select("goal, sessions_per_week").eq("user_id", userId).maybeSingle(),
    intent === "today" ? loadConditions(supabase, null).catch(() => null) : Promise.resolve(null),
  ]);

  const byWeek = new Map(
    (check("my_weekly_series", weekly) as Record<string, unknown>[]).map((r) => [String(r.week_start).slice(0, 10), r]),
  );
  const weeks: WeekRow[] = Array.from({ length: 13 }, (_, i) => {
    const ws = addDays(firstWeek, 7 * i);
    const r = byWeek.get(ws);
    return {
      weekStart: ws,
      distanceM: Number(r?.distance_m ?? 0),
      runs: Number(r?.activities ?? 0),
      movingS: Number(r?.moving_seconds ?? 0),
      activeDays: Number(r?.active_days ?? 0),
    };
  });

  const statuses = (check("scheduled_workouts", pastPlan) as { status: string }[]).map((r) => r.status);
  const nowHour = conditions?.hours[0];

  return {
    today,
    nowMs,
    weeks,
    runs: (check("activities", runs) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      localDate: localDate(r.started_at as string, timezone),
      distanceM: Number(r.distance_m),
      movingS: Number(r.moving_seconds),
      avgPaceS: r.avg_pace_s === null ? null : Number(r.avg_pace_s),
      name: (r.name as string | null) ?? null,
    })),
    efforts: (check("my_best_efforts", efforts) as Record<string, unknown>[]).map((e) => ({
      key: e.distance_key as PrKey,
      seconds: Number(e.seconds),
      activityId: e.activity_id as string,
      startedAt: new Date(e.started_at as string).toISOString(),
    })),
    plan: {
      upcoming: (check("scheduled_workouts", upcoming) as Record<string, unknown>[]).map((w) => ({
        title: w.title as string,
        workoutType: w.workout_type as string,
        startsAt: localDate(w.starts_at as string, timezone),
        durationMinutes: Number(w.duration_minutes),
      })),
      past28: {
        planned: statuses.length,
        completed: statuses.filter((s) => s === "completed").length,
        missed: statuses.filter((s) => s === "missed").length,
      },
    },
    prefs: prefs.data
      ? { goal: prefs.data.goal as string, sessionsPerWeek: Number(prefs.data.sessions_per_week) }
      : null,
    conditions:
      conditions && nowHour && conditions.forecast
        ? {
            place: conditions.place.name,
            summary: `${Math.round(nowHour.tempC)}°C, feels like ${Math.round(nowHour.apparentC ?? nowHour.tempC)}°C, score ${nowHour.score} of 100 (${nowHour.level})${conditions.forecast.live ? `, ${conditions.forecast.attribution}` : " (sample data, not live weather)"}`,
            nowLevel: nowHour.level,
          }
        : null,
    raceGoal: null,
    recovery: [],
  };
}
