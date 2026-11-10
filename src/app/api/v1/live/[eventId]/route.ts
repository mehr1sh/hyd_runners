import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { liveState } from "@/features/live/queries";

/** GET /api/v1/live/[eventId]: the live view for polling. Visibility is decided by RLS. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/live/[eventId]">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { eventId } = await ctx.params;
  if (!z.uuid().safeParse(eventId).success) return fail("not_found", "Run not found.");
  try {
    const state = await liveState(auth.caller.supabase, eventId, auth.caller.user.id);
    if (!state) return fail("not_found", "Run not found.");
    return ok(state);
  } catch (error) {
    return internalError("load live state", error);
  }
}
