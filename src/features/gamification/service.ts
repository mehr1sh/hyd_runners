import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE, type WorkoutType } from "@/lib/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlannedWorkouts } from "@/features/workouts/planned-source";
import { computeRewards } from "./logic/rewards";
import { localDate } from "./logic/time";
import type { Award, EnrollmentFact, RewardHistory, WorkoutFact } from "./logic/types";

/**
 * Server-side reward reconciliation. Loads the runner's full history with
 * the secret key, recomputes rewards with the pure engine, and inserts
 * anything new. Every insert is ON CONFLICT DO NOTHING on a deterministic
 * key, so calling this any number of times is safe.
 */

export async function getUserTimezone(client: SupabaseClient, userId: string) {
  const { data } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data?.timezone as string | undefined) || DEFAULT_TIMEZONE;
}

type LogRow = {
  id: string;
  workout_type: WorkoutType;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  programme_session_id: string | null;
  enrollment_id: string | null;
  planned_workout_id: string | null;
};

export async function loadRewardHistory(admin: SupabaseClient, userId: string): Promise<RewardHistory> {
  const timezone = await getUserTimezone(admin, userId);

  const [logs, enrollments, rsvp, ledger] = await Promise.all([
    admin
      .from("workout_logs")
      .select(
        "id, workout_type, started_at, completed_at, duration_seconds, distance_meters, programme_session_id, enrollment_id, planned_workout_id",
      )
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("started_at")
      .limit(5000),
    admin.from("enrollments").select("id, programmes!inner(slug, programme_sessions(id, week))").eq("user_id", userId),
    admin
      .from("event_rsvps")
      .select("created_at")
      .eq("user_id", userId)
      .eq("status", "going")
      .order("created_at")
      .limit(1),
    admin.from("xp_ledger").select("award_key").eq("user_id", userId).like("award_key", "streak:%"),
  ]);
  for (const r of [logs, enrollments, rsvp, ledger]) if (r.error) throw new Error(r.error.message);

  const rows = (logs.data ?? []) as LogRow[];
  const plannedIds = rows.map((r) => r.planned_workout_id).filter((x): x is string => !!x);
  const planned = await getPlannedWorkouts(admin, userId, plannedIds);
  const plannedDate = new Map(planned.map((p) => [p.id, localDate(p.startsAt, timezone)]));

  const workouts: WorkoutFact[] = rows.map((r) => ({
    id: r.id,
    workoutType: r.workout_type,
    startedAt: new Date(r.started_at).toISOString(),
    completedAt: new Date(r.completed_at).toISOString(),
    durationSeconds: r.duration_seconds,
    distanceMeters: r.distance_meters,
    programmeSessionId: r.programme_session_id,
    enrollmentId: r.enrollment_id,
    plannedWorkoutId: r.planned_workout_id,
    plannedDate: r.planned_workout_id ? (plannedDate.get(r.planned_workout_id) ?? null) : null,
  }));

  type EnrollmentRow = { id: string; programmes: { slug: string; programme_sessions: { id: string; week: number }[] } };
  const enrollmentFacts: EnrollmentFact[] = ((enrollments.data ?? []) as unknown as EnrollmentRow[]).map((e) => ({
    enrollmentId: e.id,
    programmeSlug: e.programmes.slug,
    sessions: e.programmes.programme_sessions,
  }));

  return {
    timezone,
    workouts,
    enrollments: enrollmentFacts,
    firstRsvpAt: rsvp.data?.[0]?.created_at ? new Date(rsvp.data[0].created_at).toISOString() : null,
    existingAwardKeys: (ledger.data ?? []).map((r) => r.award_key as string),
  };
}

/** Recompute and persist rewards. Returns only awards inserted by this call. */
export async function reconcileRewards(userId: string, admin = createAdminClient()): Promise<Award[]> {
  const history = await loadRewardHistory(admin, userId);
  const outcome = computeRewards(history);

  let inserted: Award[] = [];
  if (outcome.awards.length) {
    const { data, error } = await admin
      .from("xp_ledger")
      .upsert(
        outcome.awards.map((a) => ({
          user_id: userId,
          delta_xp: a.deltaXp,
          delta_coins: a.deltaCoins,
          reason: a.reason,
          ref_table: a.refTable,
          ref_id: a.refId,
          award_key: a.awardKey,
          occurred_at: a.occurredAt,
        })),
        { onConflict: "user_id,award_key", ignoreDuplicates: true },
      )
      .select("award_key");
    if (error) throw new Error(`Could not record rewards: ${error.message}`);
    const newKeys = new Set((data ?? []).map((r) => r.award_key as string));
    inserted = outcome.awards.filter((a) => newKeys.has(a.awardKey));
  }

  if (outcome.badges.length) {
    const { error } = await admin.from("user_badges").upsert(
      outcome.badges.map((b) => ({ user_id: userId, badge_code: b.code, earned_at: b.earnedAt })),
      { onConflict: "user_id,badge_code", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not record badges: ${error.message}`);
  }

  if (outcome.challenges.length) {
    const { error } = await admin.from("challenge_completions").upsert(
      outcome.challenges.map((c) => ({
        user_id: userId,
        challenge_code: c.code,
        week_start: c.weekStart,
        completed_at: c.completedAt,
      })),
      { onConflict: "user_id,challenge_code,week_start", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not record challenges: ${error.message}`);
  }

  for (const done of outcome.completedEnrollments) {
    const { error } = await admin
      .from("enrollments")
      .update({ status: "completed", completed_at: done.completedAt })
      .eq("id", done.enrollmentId)
      .eq("user_id", userId)
      .eq("status", "active");
    if (error) throw new Error(`Could not complete enrolment: ${error.message}`);
  }

  return inserted;
}
