import "server-only";
import type { WorkoutType } from "@/lib/contracts";
import type { RunnerContext } from "@/features/dashboard/context";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export type WorkoutRow = {
  id: string;
  status: "in_progress" | "completed" | "abandoned";
  title: string;
  workoutType: WorkoutType;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  perceivedEffort: number | null;
  notes: string | null;
  source: "timer" | "manual" | "simulated";
  programmeSessionId: string | null;
  enrollmentId: string | null;
  plannedWorkoutId: string | null;
  locationId: string | null;
};

const COLUMNS =
  "id, status, title, workout_type, started_at, completed_at, duration_seconds, distance_meters, perceived_effort, notes, source, programme_session_id, enrollment_id, planned_workout_id, location_id";

type Raw = Record<string, unknown>;
export function toWorkoutRow(r: Raw): WorkoutRow {
  return {
    id: r.id as string,
    status: r.status as WorkoutRow["status"],
    title: r.title as string,
    workoutType: r.workout_type as WorkoutType,
    startedAt: new Date(r.started_at as string).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    durationSeconds: (r.duration_seconds as number | null) ?? null,
    distanceMeters: (r.distance_meters as number | null) ?? null,
    perceivedEffort: (r.perceived_effort as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    source: r.source as WorkoutRow["source"],
    programmeSessionId: (r.programme_session_id as string | null) ?? null,
    enrollmentId: (r.enrollment_id as string | null) ?? null,
    plannedWorkoutId: (r.planned_workout_id as string | null) ?? null,
    locationId: (r.location_id as string | null) ?? null,
  };
}

/** Completed workouts, newest first (RLS limits to the caller). */
export async function listCompletedWorkouts(ctx: RunnerContext, limit = 1000): Promise<WorkoutRow[]> {
  const { data, error } = await ctx.supabase
    .from("workout_logs")
    .select(COLUMNS)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new DatabaseQueryError("workout_logs", error);
  return (data ?? []).map(toWorkoutRow);
}

export async function getInProgressWorkout(ctx: RunnerContext): Promise<WorkoutRow | null> {
  const { data } = await ctx.supabase.from("workout_logs").select(COLUMNS).eq("status", "in_progress").maybeSingle();
  return data ? toWorkoutRow(data) : null;
}

export async function getWorkout(ctx: RunnerContext, id: string) {
  const { data } = await ctx.supabase.from("workout_logs").select(COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const workout = toWorkoutRow(data);

  const [session, rewards, location] = await Promise.all([
    workout.programmeSessionId
      ? ctx.supabase
          .from("programme_sessions")
          .select("id, week, day, title, instructions, blocks, estimated_minutes, programmes(slug, title)")
          .eq("id", workout.programmeSessionId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    workout.completedAt
      ? ctx.supabase
          .from("xp_ledger")
          .select("award_key, reason, delta_xp, delta_coins, occurred_at")
          .or(`ref_id.eq.${workout.id},occurred_at.eq.${workout.completedAt}`)
          .order("delta_xp", { ascending: false })
      : Promise.resolve({ data: [] }),
    workout.locationId
      ? ctx.supabase.from("locations").select("name").eq("id", workout.locationId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    workout,
    session: session.data as null | {
      id: string;
      week: number;
      day: number;
      title: string;
      instructions: string;
      blocks: unknown[];
      estimated_minutes: number;
      programmes: { slug: string; title: string };
    },
    rewards: (rewards.data ?? []) as { award_key: string; reason: string; delta_xp: number; delta_coins: number }[],
    locationName: (location.data as { name: string } | null)?.name ?? null,
  };
}

export async function listLocationOptions(ctx: RunnerContext) {
  const { data } = await ctx.supabase.from("locations").select("id, name").order("name");
  return (data ?? []) as { id: string; name: string }[];
}
