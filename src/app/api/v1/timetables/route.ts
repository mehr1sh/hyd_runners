import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TimetableUpload } from "@/lib/contracts";
import { fail, ok, parseJson } from "@/lib/api/response";
import { checkDeclaredFile, EXTENSION_FOR } from "@/features/scheduler/logic/upload-validation";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { toTimetableUpload, UPLOAD_COLUMNS } from "@/features/scheduler/server/uploads";

const Body = z.object({
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().min(0),
});

/**
 * POST /api/v1/timetables — register an upload and get a one-time signed URL.
 * The browser sends the file straight to the private `timetables` bucket
 * (TECH_DECISIONS §3.8), then calls `/process`. Type and size are checked
 * here and again on the stored bytes.
 */
export async function POST(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth.caller;

  const body = await parseJson(request, Body);
  if (!body.ok) return body.response;

  const rejection = checkDeclaredFile({ type: body.data.mimeType, size: body.data.sizeBytes });
  if (rejection) {
    const code =
      rejection.code === "file_too_large"
        ? "payload_too_large"
        : rejection.code === "unsupported_type"
          ? "unsupported_media_type"
          : "validation_failed";
    return fail(code, rejection.message, { reason: rejection.code });
  }
  const mimeType = TimetableUpload.shape.mimeType.parse(body.data.mimeType);
  const storagePath = `${user.id}/${randomUUID()}.${EXTENSION_FOR[mimeType]}`;

  try {
    const { data: row, error } = await supabase
      .from("timetable_uploads")
      .insert({ storage_path: storagePath, mime_type: mimeType, size_bytes: body.data.sizeBytes })
      .select(UPLOAD_COLUMNS)
      .single();
    if (error) throw error;

    const { data: signed, error: signError } = await supabase.storage
      .from("timetables")
      .createSignedUploadUrl(storagePath);
    if (signError) {
      await supabase.from("timetable_uploads").delete().eq("id", row.id);
      throw signError;
    }
    return ok({ upload: toTimetableUpload(row), uploadUrl: signed.signedUrl }, { status: 201 });
  } catch (error) {
    return internalError("register upload", error, "Could not start the upload. Please try again.");
  }
}
