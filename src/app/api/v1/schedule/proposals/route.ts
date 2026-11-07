import { fail, ok, parseJson } from "@/lib/api/response";
import { validateAvailability } from "@/features/scheduler/logic/availability";
import { aiForCaller, internalError, requireCaller } from "@/features/scheduler/server/api";
import { callerTimezone, loadAvailability, recordAiCall } from "@/features/scheduler/server/data";
import { generateProposal } from "@/features/scheduler/server/planner";
import { GenerateBody } from "@/features/scheduler/server/schemas";

/**
 * POST /api/v1/schedule/proposals — generate a weekly proposal from the
 * caller's confirmed availability. Not saved: the runner reviews, edits and
 * then approves it with POST /api/v1/schedule/plans.
 */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth.caller;

  const body = await parseJson(request, GenerateBody);
  if (!body.ok) return body.response;

  try {
    const availability = await loadAvailability(supabase);
    const check = validateAvailability(
      availability.map((b) => ({ ...b, key: b.id, uncertainties: [], rawText: null, confirmed: true })),
      { requireFreeTime: true },
    );
    if (!check.ok) {
      return fail("validation_failed", "Confirm some free time before generating a plan.", { issues: check.issues });
    }

    const ai = body.data.useAi
      ? await aiForCaller(supabase)
      : { generator: null, unavailable: "not_requested" as const };
    const { result, ai: outcome } = await generateProposal({
      weekStart: body.data.weekStart,
      timezone: await callerTimezone(supabase, user.id),
      availability,
      settings: body.data.settings,
      generator: ai.generator,
      aiUnavailable: ai.unavailable ?? undefined,
    });

    if (outcome.status === "used" || outcome.status === "failed" || outcome.status === "rejected") {
      await recordAiCall(supabase, {
        feature: "schedule_suggestion",
        outcome: outcome.status === "used" ? "success" : outcome.status,
        errorKind: outcome.kind,
        latencyMs: outcome.latencyMs,
      });
      if (outcome.status !== "used")
        console.warn(`[scheduler] AI schedule fallback: ${outcome.status} (${outcome.kind})`);
    }

    return ok({
      proposal: result.proposal,
      unplaced: result.unplaced,
      ai: { status: outcome.status, message: outcome.message },
    });
  } catch (error) {
    return internalError("generate proposal", error, "Could not generate a plan. Please try again.");
  }
}
