import { z } from "zod";
import { fail, ok, parseJson } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { registerUpload } from "@/features/activities/server/import";

const Body = z.object({
  sizeBytes: z.number().int().min(1),
  activityType: z.enum(["run", "walk_run", "walk", "hike"]).default("run"),
  visibility: z.enum(["private", "followers", "public"]).default("private"),
  name: z.string().trim().max(120).nullable().default(null),
});

/**
 * POST /api/v1/activities — register a GPX/FIT upload and get a one-time
 * signed URL. The browser uploads the file straight to the private
 * `activity-files` bucket, then calls /api/v1/activities/:id/process.
 * Size is checked here and again on the stored bytes; the format is decided
 * from the file content during processing.
 */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, Body);
  if (!body.ok) return body.response;
  try {
    const result = await registerUpload(auth.caller.supabase, auth.caller.user.id, {
      ...body.data,
      name: body.data.name || null,
    });
    if (!result.ok) {
      if ("message" in result && result.code === "payload_too_large") return fail("payload_too_large", result.message);
      if (!("error" in result) || !result.error) return fail("bad_request", "Could not start the upload.");
      if (result.error.code === "PT429")
        return fail("rate_limited", "You've imported a lot recently. Please try again later.");
      return internalError("register activity upload", result.error, "Could not start the upload.");
    }
    return ok(
      { activityId: result.activityId, uploadUrl: result.uploadUrl, token: result.token, path: result.path },
      { status: 201 },
    );
  } catch (error) {
    return internalError("register activity upload", error, "Could not start the upload.");
  }
}
