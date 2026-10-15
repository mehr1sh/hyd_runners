import { randomUUID } from "node:crypto";
import { Id } from "@/lib/contracts";
import { fail, ok } from "@/lib/api/response";
import { aiForCaller, internalError, requireCaller } from "@/features/scheduler/server/api";
import { recordAiCall } from "@/features/scheduler/server/data";
import { processTimetable, type ProcessingFailureCode } from "@/features/scheduler/server/extraction";
import { extractPdfText } from "@/features/scheduler/server/pdf-text";
import { loadUpload, UPLOAD_COLUMNS, toTimetableUpload } from "@/features/scheduler/server/uploads";

const FAILURE_HTTP: Record<ProcessingFailureCode, Parameters<typeof fail>[0]> = {
  empty_file: "validation_failed",
  file_too_large: "payload_too_large",
  unsupported_type: "unsupported_media_type",
  content_mismatch: "unsupported_media_type",
  corrupted_pdf: "validation_failed",
  no_text: "validation_failed",
  nothing_found: "validation_failed",
  image_needs_ai: "ai_unavailable",
  ai_failed: "ai_unavailable",
};

/**
 * POST /api/v1/timetables/:id/process — read an uploaded timetable and return
 * rows for review. Nothing is saved as availability here; the runner confirms
 * rows with PUT /api/v1/availability. Safe to call again to retry.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/timetables/[id]/process">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.caller;

  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("not_found", "Timetable not found.");

  try {
    const upload = await loadUpload(supabase, id.data);
    if (!upload) return fail("not_found", "Timetable not found.");
    if (upload.status === "processing") return fail("conflict", "This timetable is already being read.");
    if (upload.status === "confirmed") return fail("conflict", "This timetable has already been confirmed.");

    await supabase.from("timetable_uploads").update({ status: "processing", error_code: null }).eq("id", upload.id);

    const { data: blob, error: downloadError } = await supabase.storage.from("timetables").download(upload.storagePath);
    if (downloadError || !blob) {
      await supabase
        .from("timetable_uploads")
        .update({ status: "failed", error_code: "missing_file" })
        .eq("id", upload.id);
      return fail("not_found", "The file did not finish uploading. Upload it again.", {
        reason: "missing_file",
        retryable: false,
      });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const ai = await aiForCaller(supabase);
    const result = await processTimetable({
      bytes,
      mimeType: upload.mimeType,
      extractPdfText,
      aiExtract: ai.extractor ? async (file) => (await ai.extractor!.extractTimetable(file)).result : null,
      makeKey: () => randomUUID(),
    });

    if (result.ai.attempted) {
      await recordAiCall(supabase, {
        feature: "timetable_extraction",
        outcome: result.ai.ok ? "success" : "failed",
        errorKind: result.ai.kind,
        latencyMs: result.ai.latencyMs,
      });
    }

    const { data: row, error: updateError } = await supabase
      .from("timetable_uploads")
      .update({
        status: result.ok ? "needs_review" : "failed",
        method: result.ok ? result.method : null,
        error_code: result.ok ? null : result.code,
        ...(result.ai.attempted ? { ai_attempted_at: new Date().toISOString() } : {}),
      })
      .eq("id", upload.id)
      .select(UPLOAD_COLUMNS)
      .single();
    if (updateError) throw updateError;

    if (!result.ok) {
      return fail(FAILURE_HTTP[result.code], result.message, {
        reason: result.code,
        retryable: result.retryable,
        aiUnavailable: ai.unavailable,
      });
    }
    return ok({
      upload: toTimetableUpload(row),
      method: result.method,
      completeness: result.completeness,
      drafts: result.drafts,
      notes: result.notes,
      aiUnavailable: ai.unavailable,
    });
  } catch (error) {
    await supabase.from("timetable_uploads").update({ status: "failed", error_code: "internal" }).eq("id", id.data);
    return internalError(
      "process timetable",
      error,
      "We could not read this timetable. Try again, or enter your times by hand.",
    );
  }
}
