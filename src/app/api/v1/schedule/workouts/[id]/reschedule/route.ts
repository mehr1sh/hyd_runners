import { Id } from "@/lib/contracts";
import { fail, ok } from "@/lib/api/response";
import { findRescheduleSlot } from "@/features/scheduler/logic/edit";
import { instantToLocal, localToInstant, toMinutes } from "@/features/scheduler/logic/time";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import {
  loadAvailability,
  loadPlanById,
  loadWorkout,
  rescheduleWorkout,
  workoutToSession,
} from "@/features/scheduler/server/data";

/**
 * POST /api/v1/schedule/workouts/:id/reschedule — move a missed session to the
 * next valid slot in the rest of its week. The new slot must pass the same
 * validation as an approved plan (free time, no overlaps, rest days, no
 * back-to-back hard days). If no slot exists, the plan is left unchanged and
 * the reason is returned (409).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/schedule/workouts/[id]/reschedule">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.caller;

  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("not_found", "Session not found.");

  try {
    const found = await loadWorkout(supabase, id.data);
    if (!found || !found.planId) return fail("not_found", "Session not found.");
    if (found.workout.status !== "planned" && found.workout.status !== "missed") {
      return fail("conflict", `This session is ${found.workout.status} and cannot be moved.`);
    }
    const plan = await loadPlanById(supabase, found.planId);
    if (!plan) return fail("not_found", "Session not found.");

    const now = instantToLocal(new Date().toISOString(), plan.timezone);
    let notBefore: { weekday: number; minutes: number };
    if (now.weekStart < plan.weekStart) notBefore = { weekday: 1, minutes: 0 };
    else if (now.weekStart > plan.weekStart) {
      return fail("conflict", "This week is over, so the session cannot be moved. Plan next week instead.");
    } else notBefore = { weekday: now.weekday, minutes: now.minutes };

    const others = plan.workouts
      .filter((w) => w.id !== found.workout.id && (w.status === "planned" || w.status === "completed"))
      .map((w) => workoutToSession(w, plan.timezone));
    const result = findRescheduleSlot({
      missed: workoutToSession(found.workout, plan.timezone),
      others,
      availability: await loadAvailability(supabase),
      settings: plan.settings,
      notBefore,
    });
    if (!result.ok) return fail("conflict", result.reason, { reason: "no_valid_slot" });

    await rescheduleWorkout(
      supabase,
      found.workout.id,
      localToInstant(plan.weekStart, result.weekday, toMinutes(result.startTime), plan.timezone),
      result.rationale,
    );
    return ok(await loadPlanById(supabase, plan.id));
  } catch (error) {
    return internalError("reschedule session", error, "Could not move this session. Your plan is unchanged.");
  }
}
