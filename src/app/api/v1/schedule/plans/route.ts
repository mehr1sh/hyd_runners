import { fail, ok, parseJson } from "@/lib/api/response";
import { validateSchedule } from "@/features/scheduler/logic/validate-schedule";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import {
  approvePlan,
  callerTimezone,
  latestSettings,
  loadApprovedPlan,
  loadAvailability,
  loadPlanById,
  PlanExistsError,
} from "@/features/scheduler/server/data";
import { ApproveBody, WeekStart } from "@/features/scheduler/server/schemas";

/**
 * GET /api/v1/schedule/plans?weekStart=YYYY-MM-DD — the caller's approved plan
 * for that week (or null), plus the settings of their latest plan to prefill
 * the planner.
 */
export async function GET(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const weekStart = WeekStart.safeParse(new URL(request.url).searchParams.get("weekStart"));
  if (!weekStart.success) return fail("validation_failed", "weekStart must be a Monday (YYYY-MM-DD).");
  try {
    const [plan, settings] = await Promise.all([
      loadApprovedPlan(auth.caller.supabase, weekStart.data),
      latestSettings(auth.caller.supabase),
    ]);
    return ok({ plan, latestSettings: settings });
  } catch (error) {
    return internalError("load plan", error, "Could not load your plan.");
  }
}

/**
 * POST /api/v1/schedule/plans — approve a proposal. The whole week is
 * validated again on the server; nothing is saved unless every hard
 * constraint holds. An existing approved plan for the week is only replaced
 * when `replaceExisting` is true (otherwise 409), so repeated or stale
 * approvals cannot overwrite or duplicate a plan.
 */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth.caller;

  const body = await parseJson(request, ApproveBody);
  if (!body.ok) return body.response;
  if (body.data.sessions.length === 0) {
    return fail("validation_failed", "A plan needs at least one session before it can be approved.");
  }

  try {
    const availability = await loadAvailability(supabase);
    const violations = validateSchedule(body.data.sessions, { availability, settings: body.data.settings });
    if (violations.length > 0) {
      return fail("validation_failed", "This plan breaks a scheduling rule, so it was not saved.", { violations });
    }
    const planId = await approvePlan(supabase, {
      weekStart: body.data.weekStart,
      timezone: await callerTimezone(supabase, user.id),
      source: body.data.source,
      settings: body.data.settings,
      sessions: body.data.sessions,
      replaceExisting: body.data.replaceExisting,
    });
    return ok(await loadPlanById(supabase, planId), { status: 201 });
  } catch (error) {
    if (error instanceof PlanExistsError) {
      return fail("conflict", "You already approved a plan for this week. Choose “Replace approved plan” to swap it.", {
        reason: "plan_exists",
      });
    }
    return internalError(
      "approve plan",
      error,
      "Could not save your plan. Your proposal is still on screen; try again.",
    );
  }
}
