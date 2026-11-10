import { z } from "zod";
import { fail, ok, parseJson } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { MAX_ACCURACY_M, PositionBody } from "@/features/live/logic";

/** POST /api/v1/live/[eventId]/position: the caller's latest position while they are sharing. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/live/[eventId]/position">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { eventId } = await ctx.params;
  if (!z.uuid().safeParse(eventId).success) return fail("not_found", "Run not found.");
  const body = await parseJson(request, PositionBody);
  if (!body.ok) return body.response;
  if (body.data.accuracy !== null && body.data.accuracy > MAX_ACCURACY_M) return ok({ status: "inaccurate" });
  try {
    const { data: session } = await auth.caller.supabase
      .from("live_sessions")
      .select("id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!session) return ok({ status: "not_sharing" });
    const { data, error } = await auth.caller.supabase.rpc("update_live_position", {
      p_session: session.id,
      p_lat: body.data.lat,
      p_lon: body.data.lon,
      p_accuracy: body.data.accuracy,
      p_recorded_at: body.data.recordedAt,
    });
    if (error) throw error;
    return ok({ status: data as string });
  } catch (error) {
    return internalError("store live position", error);
  }
}
