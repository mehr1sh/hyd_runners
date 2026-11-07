import { ok, parseJson } from "@/lib/api/response";
import { validateSchedule } from "@/features/scheduler/logic/validate-schedule";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { loadAvailability } from "@/features/scheduler/server/data";
import { ValidateBody } from "@/features/scheduler/server/schemas";

/** POST /api/v1/schedule/validate — check an edited proposal against the caller's confirmed availability and the recovery rules. */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, ValidateBody);
  if (!body.ok) return body.response;
  try {
    const availability = await loadAvailability(auth.caller.supabase);
    const violations = validateSchedule(body.data.sessions, { availability, settings: body.data.settings });
    return ok({ valid: violations.length === 0, violations });
  } catch (error) {
    return internalError("validate proposal", error);
  }
}
