import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { addDays, localMidnightUtc, weekStart, type LocalDate } from "@/features/gamification/logic/time";
import type { DnaActivity } from "./logic/performance";
import type { PrKey } from "./logic/normalize";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

export type Range = { from: LocalDate; to: LocalDate; label: string };

/** Week, month, year or a custom pair of local dates (inclusive). */
export function resolveRange(kind: string | undefined, today: LocalDate, from?: string, to?: string): Range {
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  if (kind === "custom" && valid(from) && valid(to) && from! <= to!)
    return { from: from!, to: to!, label: `${from} to ${to}` };
  if (kind === "week") return { from: weekStart(today), to: today, label: "This week" };
  if (kind === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `${today.slice(0, 4)} so far` };
  if (kind === "12w") return { from: addDays(weekStart(today), -77), to: today, label: "Last 12 weeks" };
  return { from: `${today.slice(0, 7)}-01`, to: today, label: "This month" };
}

export async function loadPerformance(
  supabase: SupabaseClient,
  userId: string,
  range: Range,
  timezone: string,
  today: LocalDate,
) {
  const fromTs = localMidnightUtc(range.from, timezone).toISOString();
  const toTs = localMidnightUtc(addDays(range.to, 1), timezone).toISOString();
  const trendFrom = localMidnightUtc(addDays(weekStart(today), -7 * 25), timezone).toISOString();
  const dnaFrom = localMidnightUtc(addDays(weekStart(today), -7 * 15), timezone).toISOString();
  const tomorrow = localMidnightUtc(addDays(today, 1), timezone).toISOString();

  const [summary, weekly, efforts, bands, mix, dnaRows, races, planned, plannedDone] = await Promise.all([
    supabase.rpc("my_activity_summary", { p_from: fromTs, p_to: toTs, p_timezone: timezone }),
    supabase.rpc("my_weekly_series", {
      p_from: trendFrom,
      p_to: tomorrow,
      p_timezone: timezone,
      p_types: ["run", "walk_run"],
    }),
    supabase.rpc("my_best_efforts"),
    supabase.rpc("my_pace_by_distance", { p_from: fromTs, p_to: toTs }),
    supabase.rpc("my_training_mix", { p_from: fromTs, p_to: toTs }),
    supabase
      .from("activities")
      .select("started_at, distance_m, avg_pace_s, activity_type")
      .eq("user_id", userId)
      .eq("status", "ready")
      .gte("started_at", dnaFrom)
      .order("started_at", { ascending: false })
      .limit(400),
    supabase
      .from("event_results")
      .select("outcome, finish_seconds, distance_meters, events!inner(id, title, starts_at)")
      .eq("user_id", userId)
      .eq("outcome", "finished")
      .order("recorded_at", { ascending: false })
      .limit(20),
    supabase
      .from("scheduled_workouts")
      .select("id", { count: "exact", head: true })
      .neq("status", "rescheduled")
      .gte("starts_at", fromTs)
      .lt("starts_at", toTs),
    supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .not("planned_workout_id", "is", null)
      .gte("started_at", fromTs)
      .lt("started_at", toTs),
  ]);

  const s = (check("my_activity_summary", summary) as Record<string, unknown>[])[0] ?? {};
  const thisWeek = weekStart(today);
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const dayIdx: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const dna: DnaActivity[] = (check("activities", dnaRows) as Record<string, unknown>[]).map((r) => {
    const d = localDate.format(new Date(r.started_at as string));
    return {
      startedAt: r.started_at as string,
      weekday: dayIdx[weekdayFmt.format(new Date(r.started_at as string))],
      weeksAgo: Math.floor((Date.parse(thisWeek) - Date.parse(weekStart(d))) / (7 * 86_400_000)),
      distanceM: Number(r.distance_m),
      avgPace: n(r.avg_pace_s),
      type: r.activity_type as DnaActivity["type"],
    };
  });

  return {
    summary: {
      activities: Number(s.activities ?? 0),
      distanceM: Number(s.distance_m ?? 0),
      movingSeconds: Number(s.moving_seconds ?? 0),
      elevationGainM: Number(s.elevation_gain_m ?? 0),
      avgPace: n(s.avg_pace_s),
      activeDays: Number(s.active_days ?? 0),
      longestM: n(s.longest_m),
      runs: Number(s.runs ?? 0),
      walks: Number(s.walks ?? 0),
      hikes: Number(s.hikes ?? 0),
    },
    weekly: (check("my_weekly_series", weekly) as Record<string, unknown>[]).map((w) => ({
      weekStart: w.week_start as string,
      distanceKm: Math.round(Number(w.distance_m) / 100) / 10,
      avgPace: n(w.avg_pace_s),
      activeDays: Number(w.active_days),
    })),
    efforts: (check("my_best_efforts", efforts) as Record<string, unknown>[]).map((e) => ({
      key: e.distance_key as PrKey,
      seconds: Number(e.seconds),
      activityId: e.activity_id as string,
      startedAt: e.started_at as string,
    })),
    bands: (check("my_pace_by_distance", bands) as Record<string, unknown>[]).map((b) => ({
      band: b.band as string,
      activities: Number(b.activities),
      avgPace: n(b.avg_pace_s),
    })),
    mix: (check("my_training_mix", mix) as Record<string, unknown>[]).map((m) => ({
      category: m.category as string,
      sessions: Number(m.sessions),
    })),
    dna,
    races: (
      check("event_results", races) as unknown as {
        finish_seconds: number | null;
        events: { id: string; title: string; starts_at: string };
      }[]
    ).map((r) => ({
      eventId: r.events.id,
      title: r.events.title,
      startsAt: r.events.starts_at,
      finishSeconds: r.finish_seconds,
    })),
    planned: { planned: planned.count ?? 0, completed: plannedDone.count ?? 0 },
  };
}

export async function loadYear(supabase: SupabaseClient, year: number, timezone: string) {
  const { data, error } = await supabase.rpc("my_year_in_running", { p_year: year, p_timezone: timezone });
  if (error) throw new DatabaseQueryError("my_year_in_running", error);
  return data as {
    year: number;
    activities: number;
    distanceM: number;
    movingSeconds: number;
    elevationGainM: number;
    longest: { id: string; distanceM: number; startedAt: string } | null;
    fastest5k: { id: string; seconds: number; startedAt: string } | null;
    mostActiveMonth: { month: number; distanceM: number; activities: number } | null;
    mostRepeatedRoute: { times: number; exampleActivityId: string } | null;
    groupRunsAttended: number;
    eventsAttended: number;
    clubs: number;
  };
}

export async function routeMatches(supabase: SupabaseClient, activityId: string) {
  const { data, error } = await supabase.rpc("my_route_matches", { p_activity_id: activityId });
  if (error) throw new DatabaseQueryError("my_route_matches", error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    activityId: r.activity_id as string,
    startedAt: r.started_at as string,
    distanceM: Number(r.distance_m),
    movingSeconds: Number(r.moving_seconds),
    avgPace: n(r.avg_pace_s),
    elevationGainM: n(r.elevation_gain_m),
    hausdorffM: Number(r.hausdorff_m),
  }));
}
