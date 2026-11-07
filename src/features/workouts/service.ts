import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkoutType } from "@/lib/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileRewards } from "@/features/gamification/service";
import type { Award } from "@/features/gamification/logic/types";
import { getPlannedWorkouts } from "./planned-source";
import { checkPlausibility, type CompletionInput, type ManualWorkoutInput } from "./logic/validate";

/**
 * Workout persistence. Runners can only read workout_logs; every write goes
 * through these functions with the secret key after the caller's identity
 * has been verified by the server action. Runner sessions deliberately have
 * no write access: the session and publishable key also live in the browser,
 * so any write RLS allowed could be made directly against the API, skipping
 * the plausibility, ownership and state checks below. Workouts are reward
 * inputs (XP, badges, leaderboard), so those checks must not be bypassable.
 * All operations are idempotent:
 *  - start returns the existing in-progress workout instead of a second one;
 *  - complete only transitions rows that are still in progress;
 *  - manual entries are keyed by a client-generated idempotency key;
 *  - unique indexes stop a programme session or planned workout being
 *    completed twice;
 *  - rewards are reconciled with deterministic award keys.
 */

export class WorkoutError extends Error {
  constructor(
    public code: "not_found" | "forbidden" | "conflict" | "validation_failed",
    message: string,
  ) {
    super(message);
  }
}

export type StartTarget =
  | { kind: "programme"; enrollmentId: string; sessionId: string }
  | { kind: "planned"; plannedWorkoutId: string }
  | { kind: "free"; workoutType: Exclude<WorkoutType, "rest">; title: string };

export type WorkoutResult = { workoutId: string; alreadyCompleted: boolean; newAwards: Award[] };

const UNIQUE_VIOLATION = "23505";

type Link = {
  title: string;
  workoutType: WorkoutType;
  enrollmentId: string | null;
  programmeSessionId: string | null;
  plannedWorkoutId: string | null;
};

/** Resolve what a workout is linked to, checking it belongs to the runner. */
async function resolveTarget(admin: SupabaseClient, userId: string, target: StartTarget): Promise<Link> {
  if (target.kind === "free") {
    return {
      title: target.title,
      workoutType: target.workoutType,
      enrollmentId: null,
      programmeSessionId: null,
      plannedWorkoutId: null,
    };
  }
  if (target.kind === "planned") {
    const [planned] = await getPlannedWorkouts(admin, userId, [target.plannedWorkoutId]);
    if (!planned) throw new WorkoutError("not_found", "That planned workout was not found.");
    return {
      title: planned.title,
      workoutType: planned.workoutType,
      enrollmentId: planned.enrollmentId,
      programmeSessionId: planned.programmeSessionId,
      plannedWorkoutId: planned.id,
    };
  }
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, status, programme_id")
    .eq("id", target.enrollmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!enrollment) throw new WorkoutError("not_found", "You are not enrolled in that programme.");
  if (enrollment.status !== "active") throw new WorkoutError("forbidden", "That programme is not active for you.");
  const { data: session } = await admin
    .from("programme_sessions")
    .select("id, title, workout_type, programme_id")
    .eq("id", target.sessionId)
    .maybeSingle();
  if (!session || session.programme_id !== enrollment.programme_id)
    throw new WorkoutError("not_found", "That session is not part of your programme.");
  return {
    title: session.title,
    workoutType: session.workout_type,
    enrollmentId: enrollment.id,
    programmeSessionId: session.id,
    plannedWorkoutId: null,
  };
}

function mapUniqueViolation(error: { code?: string; message: string }): never {
  if (error.code === UNIQUE_VIOLATION) {
    if (error.message.includes("session_once") || error.message.includes("planned_once"))
      throw new WorkoutError("conflict", "You have already completed this session.");
    if (error.message.includes("one_in_progress"))
      throw new WorkoutError("conflict", "Finish or discard your current workout first.");
  }
  throw new Error(error.message);
}

/** Start a workout (or return the one already in progress for the same target). */
export async function startWorkout(userId: string, target: StartTarget, admin = createAdminClient()) {
  const link = await resolveTarget(admin, userId, target);

  const { data: current } = await admin
    .from("workout_logs")
    .select("id, programme_session_id, planned_workout_id, title")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (current) {
    const same =
      current.programme_session_id === link.programmeSessionId &&
      current.planned_workout_id === link.plannedWorkoutId &&
      (link.programmeSessionId || link.plannedWorkoutId || current.title === link.title);
    if (same) return { workoutId: current.id as string, resumed: true };
    throw new WorkoutError("conflict", "Finish or discard your current workout first.");
  }

  if (link.programmeSessionId) {
    const { data: done } = await admin
      .from("workout_logs")
      .select("id")
      .eq("enrollment_id", link.enrollmentId)
      .eq("programme_session_id", link.programmeSessionId)
      .eq("status", "completed")
      .maybeSingle();
    if (done) throw new WorkoutError("conflict", "You have already completed this session.");
  }

  const { data, error } = await admin
    .from("workout_logs")
    .insert({
      user_id: userId,
      status: "in_progress",
      title: link.title,
      workout_type: link.workoutType,
      enrollment_id: link.enrollmentId,
      programme_session_id: link.programmeSessionId,
      planned_workout_id: link.plannedWorkoutId,
      started_at: new Date().toISOString(),
      source: "timer",
      idempotency_key: crypto.randomUUID(),
    })
    .select("id")
    .single();
  if (error) mapUniqueViolation(error);
  return { workoutId: data!.id as string, resumed: false };
}

/** Complete an in-progress workout. A repeated request returns the first result. */
export async function completeWorkout(
  userId: string,
  workoutId: string,
  input: CompletionInput,
  admin = createAdminClient(),
): Promise<WorkoutResult> {
  const { data: row } = await admin
    .from("workout_logs")
    .select("id, user_id, status, workout_type, started_at")
    .eq("id", workoutId)
    .maybeSingle();
  if (!row || row.user_id !== userId) throw new WorkoutError("not_found", "Workout not found.");
  if (row.status === "completed") return { workoutId, alreadyCompleted: true, newAwards: [] };
  if (row.status === "abandoned") throw new WorkoutError("conflict", "This workout was discarded.");

  const now = new Date();
  const durationSeconds = input.durationMinutes * 60;
  const distanceMeters = input.distanceKm === null ? null : Math.round(input.distanceKm * 1000);
  const startedAt = new Date(row.started_at);
  // A timer workout started now cannot "end in the future": clamp the start.
  const effectiveStart =
    startedAt.getTime() + durationSeconds * 1000 > now.getTime()
      ? new Date(now.getTime() - durationSeconds * 1000)
      : startedAt;
  const problem = checkPlausibility({
    workoutType: row.workout_type,
    startedAt: effectiveStart,
    durationSeconds,
    distanceMeters,
    now,
    allowBackdate: true,
  });
  if (problem) throw new WorkoutError("validation_failed", problem);

  const { data: updated, error } = await admin
    .from("workout_logs")
    .update({
      status: "completed",
      started_at: effectiveStart.toISOString(),
      completed_at: new Date(effectiveStart.getTime() + durationSeconds * 1000).toISOString(),
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters,
      perceived_effort: input.perceivedEffort,
      notes: input.notes,
      location_id: input.locationId,
    })
    .eq("id", workoutId)
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .select("id");
  if (error) mapUniqueViolation(error);
  // Zero rows: a concurrent request completed it first.
  if (!updated?.length) return { workoutId, alreadyCompleted: true, newAwards: [] };

  const newAwards = await reconcileRewards(userId, admin);
  return { workoutId, alreadyCompleted: false, newAwards };
}

/** Log a finished workout after the fact (no timer). Keyed by `idempotencyKey`. */
export async function logManualWorkout(
  userId: string,
  input: ManualWorkoutInput & { link?: StartTarget },
  options: { allowBackdate?: boolean; source?: "manual" | "simulated"; now?: Date; reconcile?: boolean } = {},
  admin = createAdminClient(),
): Promise<WorkoutResult> {
  const { data: existing } = await admin
    .from("workout_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return { workoutId: existing.id as string, alreadyCompleted: true, newAwards: [] };

  const link: Link = input.link
    ? await resolveTarget(admin, userId, input.link)
    : {
        title: input.title,
        workoutType: input.workoutType,
        enrollmentId: null,
        programmeSessionId: null,
        plannedWorkoutId: null,
      };

  const startedAt = new Date(input.startedAt);
  const durationSeconds = input.durationMinutes * 60;
  const distanceMeters = input.distanceKm === null ? null : Math.round(input.distanceKm * 1000);
  const problem = checkPlausibility({
    workoutType: link.workoutType,
    startedAt,
    durationSeconds,
    distanceMeters,
    now: options.now ?? new Date(),
    allowBackdate: options.allowBackdate,
  });
  if (problem) throw new WorkoutError("validation_failed", problem);

  const { data, error } = await admin
    .from("workout_logs")
    .insert({
      user_id: userId,
      status: "completed",
      title: link.programmeSessionId || link.plannedWorkoutId ? link.title : input.title,
      workout_type: link.workoutType,
      enrollment_id: link.enrollmentId,
      programme_session_id: link.programmeSessionId,
      planned_workout_id: link.plannedWorkoutId,
      started_at: startedAt.toISOString(),
      completed_at: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters,
      perceived_effort: input.perceivedEffort,
      notes: input.notes,
      location_id: input.locationId,
      source: options.source ?? "manual",
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION && error.message.includes("idempotency")) {
      const { data: again } = await admin
        .from("workout_logs")
        .select("id")
        .eq("user_id", userId)
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      return { workoutId: again!.id as string, alreadyCompleted: true, newAwards: [] };
    }
    mapUniqueViolation(error);
  }

  const newAwards = options.reconcile === false ? [] : await reconcileRewards(userId, admin);
  return { workoutId: data!.id as string, alreadyCompleted: false, newAwards };
}

export async function abandonWorkout(userId: string, workoutId: string, admin = createAdminClient()) {
  const { error } = await admin
    .from("workout_logs")
    .update({ status: "abandoned" })
    .eq("id", workoutId)
    .eq("user_id", userId)
    .eq("status", "in_progress");
  if (error) throw new Error(error.message);
}
