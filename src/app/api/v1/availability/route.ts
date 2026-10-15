import { z } from "zod";
import { Id } from "@/lib/contracts";
import { fail, ok, parseJson } from "@/lib/api/response";
import { validateAvailability } from "@/features/scheduler/logic/availability";
import { AvailabilityDraft } from "@/features/scheduler/logic/types";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { loadAvailability, replaceAvailability } from "@/features/scheduler/server/data";
import { loadUpload, removeStoredFile } from "@/features/scheduler/server/uploads";

/** GET /api/v1/availability — the caller's confirmed weekly availability (`AvailabilityBlock[]`). */
export async function GET(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  try {
    return ok(await loadAvailability(auth.caller.supabase));
  } catch (error) {
    return internalError("load availability", error, "Could not load your availability.");
  }
}

const Body = z.object({
  drafts: z.array(AvailabilityDraft).max(100),
  sourceUploadId: Id.nullable().default(null),
});

/**
 * PUT /api/v1/availability — replace the caller's availability with reviewed
 * rows. Every row must be complete, valid and confirmed; otherwise nothing is
 * saved and `details.issues` lists what to fix. When the rows came from an
 * uploaded timetable, the stored file is deleted after saving.
 */
export async function PUT(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.caller;

  const body = await parseJson(request, Body);
  if (!body.ok) return body.response;

  const check = validateAvailability(body.data.drafts, { requireConfirmed: true });
  if (!check.ok) {
    return fail("validation_failed", "Some rows need fixing before they can be saved.", { issues: check.issues });
  }

  try {
    const upload = body.data.sourceUploadId ? await loadUpload(supabase, body.data.sourceUploadId) : null;
    if (body.data.sourceUploadId && !upload) return fail("not_found", "Timetable not found.");

    await replaceAvailability(supabase, check.blocks, upload?.id ?? null);
    if (upload) await removeStoredFile(supabase, upload.storagePath);

    return ok({
      availability: await loadAvailability(supabase),
      warnings: check.issues.filter((i) => i.severity === "warning"),
    });
  } catch (error) {
    return internalError(
      "save availability",
      error,
      "Could not save your availability. Your changes are still on screen; try again.",
    );
  }
}
