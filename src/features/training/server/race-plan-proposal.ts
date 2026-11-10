import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalDate } from "@/features/gamification/logic/time";
import type { Change } from "../logic/adapt";
import { RACE_DISTANCES } from "../logic/predict";
import { generateRacePlan, PHASE_LABEL } from "../logic/race-plan";
import { describeWorkout, type WorkoutDetails } from "../logic/workouts";
import { activeGoal, predictionsFor, preferredStartTime, recentWeeklyKm, toStoredChange } from "./data";

/**
 * The training_proposals row for a race plan, built from the runner's active
 * goal, recent training and best efforts. Nothing is written here: the caller
 * inserts the row with the runner's own client, and the runner accepts or
 * rejects it. Used by the "Generate plan" action and the local demo seed.
 */
export async function buildRacePlanProposal(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  today: LocalDate,
): Promise<{ error: string } | { row: Record<string, unknown> }> {
  const goal = await activeGoal(supabase, userId);
  if (!goal) return { error: "Set a race goal first." };
  const [{ paces }, weeklyKm, startTime] = await Promise.all([
    predictionsFor(supabase),
    recentWeeklyKm(supabase, timezone, today),
    preferredStartTime(supabase, userId),
  ]);
  const plan = generateRacePlan({
    distance: goal.distance,
    raceDate: goal.raceDate,
    today,
    level: goal.level,
    daysPerWeek: goal.daysPerWeek,
    longRunDay: goal.longRunDay,
    recentWeeklyKm: weeklyKm,
    paces,
    raceName: goal.name,
  });
  const changes: Change[] = plan.weeks.flatMap((w) =>
    w.sessions.map((x): Change => ({
      op: "add",
      title: x.title,
      workout_type: x.workoutType,
      date: x.date,
      start_time: startTime,
      duration_minutes: Math.min(300, Math.max(5, x.minutes)),
      rationale: x.rationale,
      details: { ...x.details, week: w.index, phase: w.phase },
      label: `Week ${w.index} (${PHASE_LABEL[w.phase]}), ${x.date}: ${x.title}, ${x.minutes} min${"kind" in x.details && x.details.kind !== "strength" && x.details.kind !== "race" ? `: ${describeWorkout(x.details as WorkoutDetails)}` : ""}`,
    })),
  );
  if (changes.length === 0) return { error: "The race is too close to plan sessions." };
  const race = RACE_DISTANCES.find((r) => r.key === goal.distance)!;
  return {
    row: {
      user_id: userId,
      kind: "race_plan",
      race_goal_id: goal.id,
      title: `${plan.weeks.length}-week ${race.label} plan`,
      summary: `${changes.length} sessions from ${plan.weeks[0].weekStart} to race day on ${goal.raceDate}. A recommendation for you to review: nothing is added until you accept.`,
      reasons: [...plan.warnings, ...plan.assumptions].slice(0, 12),
      changes: changes.map((c) => toStoredChange(c, timezone)),
    },
  };
}
