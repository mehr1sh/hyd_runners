import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { processActivity } from "@/features/activities/server/import";

/** POST /api/v1/activities/:id/process — parse and store an uploaded activity (idempotent). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return fail("not_found", "Activity not found.");
  try {
    const result = await processActivity(auth.caller.user.id, id.data);
    if (result.status === "failed" && result.reason === "Activity not found.") return fail("not_found", result.reason);
    return ok(result);
  } catch (error) {
    return internalError("process activity", error, "Could not process the activity. Try again.");
  }
}
