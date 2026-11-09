import { fail, ok, parseJson } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { importRecordedActivity } from "@/features/activities/server/import";
import { MAX_RECORDED_BODY_BYTES, RecordedActivityBody } from "@/features/activities/logic/recorded";

/**
 * POST /api/v1/activities/recorded — store a run recorded by the mobile app.
 *
 * Authenticated by the Supabase access token (`Authorization: Bearer`).
 * Idempotent per runner and `clientRef`: the first successful call returns
 * 201, every later call for the same recording returns the same activity with
 * 200. A recording that matches an existing activity (for example the same run
 * imported from a watch) returns 200 with status "duplicate" and that
 * activity's id. 202 means another request is still processing it; retry
 * later. See docs/mobile.md.
 */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_RECORDED_BODY_BYTES) return fail("payload_too_large", "The recording is too large to upload.");
  const body = await parseJson(request, RecordedActivityBody);
  if (!body.ok) return body.response;
  try {
    const result = await importRecordedActivity(auth.caller.supabase, auth.caller.user.id, body.data);
    switch (result.status) {
      case "ready":
        return ok(
          { status: "ready", activityId: result.activityId, created: result.created },
          { status: result.created ? 201 : 200 },
        );
      case "duplicate":
        return ok({ status: "duplicate", activityId: result.duplicateOf, created: false });
      case "processing":
        return ok({ status: "processing", activityId: result.activityId, created: false }, { status: 202 });
      case "failed":
        return result.retryable ? fail("internal_error", result.reason) : fail("validation_failed", result.reason);
    }
  } catch (error) {
    return internalError("store recorded activity", error, "Could not save the recorded run. Try again.");
  }
}
