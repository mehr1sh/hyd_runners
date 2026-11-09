import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitnessLevel } from "@/lib/contracts";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { addDays, localMidnightUtc, weekStart, type LocalDate } from "@/features/gamification/logic/time";
import { fromMinutes, instantToLocal, localToInstant, toMinutes } from "@/features/scheduler/logic/time";
import type { PrKey } from "@/features/activities/logic/normalize";
import { getForecast } from "@/features/conditions/providers";
import { CITY_CENTRE } from "@/features/conditions/server";
import { inferKind, type Change, type Session } from "../logic/adapt";
import { trainingPaces, type TrainingPaces } from "../logic/pace";
import { predictRaces, type Effort, type Prediction, type RaceKey } from "../logic/predict";

function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

export type RaceGoal = {
  id: string;
  distance: RaceKey;
  raceDate: LocalDate;
  name: string | null;
  eventId: string | null;
  targetSeconds: number | null;
  level: FitnessLevel;
  daysPerWeek: number;
  longRunDay: number;
};

export type StoredProposal = {
  id: string;
  kind: "race_plan" | "missed_session" | "adaptive" | "coach";
  status: "proposed" | "accepted" | "rejected" | "superseded";
  title: string;
  summary: string;
  reasons: string[];
  changes: (Change & { starts_at?: string })[];
  proposedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  appliedChanges: number[] | null;
};

export type UpcomingSession = Session & {
  startsAt: string;
  status: string;
  details: Record<string, unknown> | null;
  raceGoalId: string | null;
};

const TIME_OF_DAY_START: Record<string, string> = {
  early_morning: "06:00",
  morning: "07:30",
  afternoon: "16:00",
  evening: "18:00",
  night: "20:00",
};

const GOAL_COLUMNS =
  "id, distance, race_date, name, event_id, target_seconds, current_level, days_per_week, long_run_day";

export function toGoal(r: Record<string, unknown>): RaceGoal {
  return {
    id: r.id as string,
    distance: r.distance as RaceKey,
    raceDate: r.race_date as string,
    name: (r.name as string | null) ?? null,
    eventId: (r.event_id as string | null) ?? null,
    targetSeconds: (r.target_seconds as number | null) ?? null,
    level: r.current_level as FitnessLevel,
    daysPerWeek: Number(r.days_per_week),
    longRunDay: Number(r.long_run_day),
  };
}

export async function activeGoal(supabase: SupabaseClient, userId: string): Promise<RaceGoal | null> {
  const r = await supabase
    .from("race_goals")
    .select(GOAL_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const row = check("race_goals", r);
  return row ? toGoal(row) : null;
}

export function toSession(r: Record<string, unknown>, timezone: string): UpcomingSession {
  const local = instantToLocal(r.starts_at as string, timezone);
  const details = (r.details as Record<string, unknown> | null) ?? null;
  const detailKind = details?.kind as Session["kind"] | undefined;
  return {
    id: r.id as string,
    date: local.date,
    startTime: fromMinutes(local.minutes),
    startsAt: r.starts_at as string,
    title: r.title as string,
    workoutType: r.workout_type as string,
    minutes: Number(r.duration_minutes),
    kind: detailKind ?? inferKind(r.title as string, r.workout_type as string),
    status: r.status as string,
    details,
    raceGoalId: (r.race_goal_id as string | null) ?? null,
  };
}

const SESSION_COLUMNS = "id, title, workout_type, starts_at, duration_minutes, status, details, race_goal_id";

/** Planned sessions from `from` (inclusive) for `days` days. */
export async function sessionsBetween(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  from: LocalDate,
  days: number,
) {
  const r = await supabase
    .from("scheduled_workouts")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "planned")
    .gte("starts_at", localMidnightUtc(from, timezone).toISOString())
    .lt("starts_at", localMidnightUtc(addDays(from, days), timezone).toISOString())
    .order("starts_at")
    .limit(100);
  return (check("scheduled_workouts", r) as Record<string, unknown>[]).map((x) => toSession(x, timezone));
}

/** Planned sessions that ended at least six hours ago without being completed (last 14 days). */
export async function overdueSessions(supabase: SupabaseClient, userId: string, timezone: string, today: LocalDate) {
  const cutoff = new Date(Date.now() - 6 * 3_600_000);
  const r = await supabase
    .from("scheduled_workouts")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "planned")
    .gte("starts_at", localMidnightUtc(addDays(today, -14), timezone).toISOString())
    .lt("starts_at", cutoff.toISOString())
    .order("starts_at", { ascending: false })
    .limit(20);
  return (check("scheduled_workouts", r) as Record<string, unknown>[])
    .map((x) => toSession(x, timezone))
    .filter((s) => new Date(s.startsAt).getTime() + s.minutes * 60_000 < cutoff.getTime());
}

export async function proposals(supabase: SupabaseClient, userId: string): Promise<StoredProposal[]> {
  const r = await supabase
    .from("training_proposals")
    .select(
      "id, kind, status, title, summary, reasons, changes, proposed_by, created_at, decided_at, applied_changes, source_workout_id",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (check("training_proposals", r) as Record<string, unknown>[]).map((p) => ({
    id: p.id as string,
    kind: p.kind as StoredProposal["kind"],
    status: p.status as StoredProposal["status"],
    title: p.title as string,
    summary: p.summary as string,
    reasons: (p.reasons as string[]) ?? [],
    changes: p.changes as StoredProposal["changes"],
    proposedBy: (p.proposed_by as string | null) ?? null,
    createdAt: p.created_at as string,
    decidedAt: (p.decided_at as string | null) ?? null,
    appliedChanges: (p.applied_changes as number[] | null) ?? null,
  }));
}

export async function myEfforts(supabase: SupabaseClient): Promise<Effort[]> {
  const r = await supabase.rpc("my_best_efforts");
  return (check("my_best_efforts", r) as Record<string, unknown>[]).map((e) => ({
    key: e.distance_key as PrKey,
    seconds: Number(e.seconds),
    activityId: e.activity_id as string,
    startedAt: new Date(e.started_at as string).toISOString(),
  }));
}

/** Predictions plus training paces from the 5K estimate (when one exists). */
export function pacesFrom(predictions: Prediction[]): TrainingPaces | null {
  const five = predictions.find((p) => p.race === "5k");
  if (!five || !five.ok) return null;
  return trainingPaces(
    five.seconds,
    `your 5K estimate of ${Math.floor(five.seconds / 60)}:${String(five.seconds % 60).padStart(2, "0")}`,
  );
}

export async function predictionsFor(supabase: SupabaseClient) {
  const predictions = predictRaces(await myEfforts(supabase), Date.now());
  return { predictions, paces: pacesFrom(predictions), calculatedAt: new Date().toISOString() };
}

/** Average weekly run distance (km) over the last four full weeks. */
export async function recentWeeklyKm(supabase: SupabaseClient, timezone: string, today: LocalDate) {
  const from = addDays(weekStart(today), -28);
  const r = await supabase.rpc("my_weekly_series", {
    p_from: localMidnightUtc(from, timezone).toISOString(),
    p_to: localMidnightUtc(weekStart(today), timezone).toISOString(),
    p_timezone: timezone,
    p_types: ["run", "walk_run"],
  });
  const rows = check("my_weekly_series", r) as { distance_m: number | string }[];
  return rows.reduce((s, w) => s + Number(w.distance_m ?? 0), 0) / 4 / 1000;
}

export async function preferredStartTime(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("user_preferences")
    .select("preferred_times_of_day")
    .eq("user_id", userId)
    .maybeSingle();
  const first = (data?.preferred_times_of_day as string[] | undefined)?.[0];
  return (first && TIME_OF_DAY_START[first]) || "06:00";
}

export async function profileLevel(supabase: SupabaseClient, userId: string): Promise<FitnessLevel> {
  const { data } = await supabase.from("profiles").select("fitness_level").eq("id", userId).maybeSingle();
  return ((data?.fitness_level as FitnessLevel | null) ?? "returning") as FitnessLevel;
}

/** Converts a change's local date/time into the stored form (adds `starts_at`). */
export function toStoredChange(c: Change, timezone: string) {
  if (c.op !== "add") return c;
  const ws = weekStart(c.date);
  const wd = ((new Date(`${c.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return { ...c, starts_at: localToInstant(ws, wd, toMinutes(c.start_time), timezone) };
}

/** Forecast hours for the city centre, to give heat guidance for sessions in the next day or so. */
export async function forecastHours() {
  try {
    const f = await getForecast(CITY_CENTRE.lat, CITY_CENTRE.lon, Date.now());
    return f ? { hours: f.hours, live: f.live, attribution: f.attribution } : null;
  } catch {
    return null;
  }
}

export async function past14Stats(supabase: SupabaseClient, userId: string, timezone: string, today: LocalDate) {
  const r = await supabase
    .from("scheduled_workouts")
    .select("status, starts_at, duration_minutes")
    .eq("user_id", userId)
    .neq("status", "rescheduled")
    .gte("starts_at", localMidnightUtc(addDays(today, -14), timezone).toISOString())
    .lt("starts_at", localMidnightUtc(today, timezone).toISOString())
    .limit(200);
  const rows = check("scheduled_workouts", r) as { status: string }[];
  return {
    planned: rows.filter((x) => x.status !== "skipped").length,
    completed: rows.filter((x) => x.status === "completed").length,
    missed: rows.filter((x) => x.status === "missed").length,
  };
}
