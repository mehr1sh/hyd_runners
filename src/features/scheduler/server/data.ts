import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AvailabilityBlock, DEFAULT_TIMEZONE, type PlannedWorkout } from "@/lib/contracts";
import type { ValidBlock } from "../logic/availability";
import { fromMinutes, instantToLocal, localToInstant, toMinutes } from "../logic/time";
import { PlannerSettings, type ProposalSource, type ProposedSession } from "../logic/types";

/**
 * Data access for the planner. Every function takes the caller's Supabase
 * client (cookie session or bearer token), so Row Level Security decides
 * what is visible; nothing here uses the secret key.
 */

export type StoredWorkout = PlannedWorkout & { rationale: string[]; rescheduledFrom: string | null };

export type StoredPlan = {
  id: string;
  weekStart: string;
  timezone: string;
  source: ProposalSource;
  settings: PlannerSettings;
  approvedAt: string;
  workouts: StoredWorkout[];
};

const hhmm = (t: string) => t.slice(0, 5);

export async function loadAvailability(supabase: SupabaseClient): Promise<AvailabilityBlock[]> {
  const { data, error } = await supabase
    .from("availability_blocks")
    .select("id, user_id, weekday, start_time, end_time, kind, label, source, source_upload_id, confidence")
    .order("weekday")
    .order("start_time");
  if (error) throw error;
  return (data ?? []).map((r) =>
    AvailabilityBlock.parse({
      id: r.id,
      userId: r.user_id,
      weekday: r.weekday,
      startTime: hhmm(r.start_time),
      endTime: hhmm(r.end_time),
      kind: r.kind,
      label: r.label,
      source: r.source,
      sourceUploadId: r.source_upload_id,
      confidence: r.confidence === null ? null : Number(r.confidence),
    }),
  );
}

export async function replaceAvailability(
  supabase: SupabaseClient,
  blocks: ValidBlock[],
  sourceUploadId: string | null,
) {
  const { error } = await supabase.rpc("replace_availability", {
    p_blocks: blocks.map((b) => ({
      weekday: b.weekday,
      start_time: b.startTime,
      end_time: b.endTime,
      kind: b.kind,
      label: b.label,
      source: b.source,
      confidence: b.confidence,
    })),
    p_source_upload_id: sourceUploadId,
  });
  if (error) throw error;
}

function toStoredWorkout(r: Record<string, unknown>): StoredWorkout {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    enrollmentId: (r.enrollment_id as string | null) ?? null,
    programmeSessionId: (r.programme_session_id as string | null) ?? null,
    title: r.title as string,
    workoutType: r.workout_type as PlannedWorkout["workoutType"],
    startsAt: new Date(r.starts_at as string).toISOString(),
    durationMinutes: r.duration_minutes as number,
    status: r.status as PlannedWorkout["status"],
    plannedBy: r.planned_by as PlannedWorkout["plannedBy"],
    rationale: (r.rationale as string[] | null) ?? [],
    rescheduledFrom: (r.rescheduled_from as string | null) ?? null,
  };
}

const PLAN_COLUMNS = "id, week_start, timezone, source, settings, approved_at";
const WORKOUT_COLUMNS =
  "id, user_id, enrollment_id, programme_session_id, title, workout_type, starts_at, duration_minutes, status, planned_by, rationale, rescheduled_from";

async function withWorkouts(supabase: SupabaseClient, plan: Record<string, unknown>): Promise<StoredPlan> {
  const { data, error } = await supabase
    .from("scheduled_workouts")
    .select(WORKOUT_COLUMNS)
    .eq("plan_id", plan.id as string)
    .order("starts_at");
  if (error) throw error;
  return {
    id: plan.id as string,
    weekStart: plan.week_start as string,
    timezone: plan.timezone as string,
    source: plan.source as ProposalSource,
    settings: PlannerSettings.parse(plan.settings),
    approvedAt: new Date(plan.approved_at as string).toISOString(),
    workouts: (data ?? []).map(toStoredWorkout),
  };
}

export async function loadApprovedPlan(supabase: SupabaseClient, weekStart: string): Promise<StoredPlan | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select(PLAN_COLUMNS)
    .eq("week_start", weekStart)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw error;
  return data ? withWorkouts(supabase, data) : null;
}

export async function loadPlanById(supabase: SupabaseClient, planId: string): Promise<StoredPlan | null> {
  const { data, error } = await supabase.from("weekly_plans").select(PLAN_COLUMNS).eq("id", planId).maybeSingle();
  if (error) throw error;
  return data ? withWorkouts(supabase, data) : null;
}

export async function loadWorkout(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("scheduled_workouts")
    .select(`${WORKOUT_COLUMNS}, plan_id`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? { workout: toStoredWorkout(data), planId: data.plan_id as string | null } : null;
}

/** Settings from the runner's most recent approved plan, to prefill the planner. */
export async function latestSettings(supabase: SupabaseClient): Promise<PlannerSettings | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("settings")
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const parsed = PlannerSettings.safeParse(data?.settings);
  return parsed.success ? parsed.data : null;
}

export class PlanExistsError extends Error {}

export async function approvePlan(
  supabase: SupabaseClient,
  input: {
    weekStart: string;
    timezone: string;
    source: ProposalSource;
    settings: PlannerSettings;
    sessions: ProposedSession[];
    replaceExisting: boolean;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("approve_weekly_plan", {
    p_week_start: input.weekStart,
    p_timezone: input.timezone,
    p_source: input.source,
    p_settings: input.settings,
    p_sessions: input.sessions.map((s) => ({
      title: s.title,
      workout_type: s.workoutType,
      starts_at: localToInstant(input.weekStart, s.weekday, toMinutes(s.startTime), input.timezone),
      duration_minutes: s.durationMinutes,
      planned_by: s.plannedBy,
      rationale: s.rationale,
    })),
    p_replace: input.replaceExisting,
  });
  if (error?.code === "23505") throw new PlanExistsError("An approved plan already exists for this week.");
  if (error) throw error;
  return data as string;
}

export async function rescheduleWorkout(supabase: SupabaseClient, id: string, startsAt: string, rationale: string[]) {
  const { data, error } = await supabase.rpc("reschedule_workout", {
    p_workout_id: id,
    p_starts_at: startsAt,
    p_rationale: rationale,
  });
  if (error) throw error;
  return data as string;
}

/** A stored workout in local wall-clock form, for validation and rescheduling. */
export function workoutToSession(w: StoredWorkout, timezone: string): ProposedSession {
  const local = instantToLocal(w.startsAt, timezone);
  return {
    key: w.id,
    weekday: local.weekday,
    startTime: fromMinutes(local.minutes),
    durationMinutes: w.durationMinutes,
    workoutType: w.workoutType === "rest" ? "mobility" : w.workoutType,
    title: w.title,
    rationale: w.rationale,
    plannedBy: w.plannedBy === "coach" ? "runner" : w.plannedBy,
  };
}

export async function aiCallsInLastDay(supabase: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("ai_calls")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

export async function recordAiCall(
  supabase: SupabaseClient,
  call: {
    feature: "timetable_extraction" | "schedule_suggestion";
    outcome: "success" | "failed" | "rejected";
    errorKind?: string | null;
    latencyMs?: number | null;
  },
) {
  const { error } = await supabase.from("ai_calls").insert({
    feature: call.feature,
    outcome: call.outcome,
    error_kind: call.errorKind ?? null,
    latency_ms: call.latencyMs ?? null,
  });
  // Usage records must not break the runner's request.
  if (error) console.warn(`[scheduler] could not record AI usage: ${error.code}`);
}

/** The runner's timezone from their profile, defaulting to Asia/Kolkata. */
export async function callerTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data?.timezone as string | undefined) || DEFAULT_TIMEZONE;
}
