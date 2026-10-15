import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlannedWorkout } from "@/lib/contracts";

/**
 * Integration point with the schedule planner (owned by the scheduler
 * feature). Reads approved planned workouts from `scheduled_workouts` using
 * the shared PlannedWorkout contract. Until the scheduler migration exists,
 * the table is missing and this returns an empty list, so the runner
 * experience falls back to programme sessions. This module never generates
 * or edits schedules; a planned workout counts as completed when a
 * completed workout_logs row references it.
 */
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST204", "PGRST200"]);

type Row = {
  id: string;
  user_id: string;
  enrollment_id: string | null;
  programme_session_id: string | null;
  title: string;
  workout_type: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  planned_by: string;
};

const COLUMNS =
  "id, user_id, enrollment_id, programme_session_id, title, workout_type, starts_at, duration_minutes, status, planned_by";

function toContract(rows: Row[] | null): PlannedWorkout[] {
  const out: PlannedWorkout[] = [];
  for (const r of rows ?? []) {
    const parsed = PlannedWorkout.safeParse({
      id: r.id,
      userId: r.user_id,
      enrollmentId: r.enrollment_id,
      programmeSessionId: r.programme_session_id,
      title: r.title,
      workoutType: r.workout_type,
      startsAt: new Date(r.starts_at).toISOString(),
      durationMinutes: r.duration_minutes,
      status: r.status,
      plannedBy: r.planned_by,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function listPlannedWorkouts(
  client: SupabaseClient,
  userId: string,
  range: { from: Date; to: Date },
): Promise<PlannedWorkout[]> {
  const { data, error } = await client
    .from("scheduled_workouts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .gte("starts_at", range.from.toISOString())
    .lt("starts_at", range.to.toISOString())
    .order("starts_at");
  if (error) {
    if (MISSING_TABLE.has(error.code)) return [];
    throw new Error(`Could not load planned workouts: ${error.message}`);
  }
  return toContract(data as Row[]);
}

export async function getPlannedWorkouts(
  client: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<PlannedWorkout[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("scheduled_workouts").select(COLUMNS).eq("user_id", userId).in("id", ids);
  if (error) {
    if (MISSING_TABLE.has(error.code)) return [];
    throw new Error(`Could not load planned workouts: ${error.message}`);
  }
  return toContract(data as Row[]);
}
