import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TimetableUpload } from "@/lib/contracts";

export const UPLOAD_COLUMNS = "id, user_id, storage_path, mime_type, status, method, error_code, created_at";

export function toTimetableUpload(r: Record<string, unknown>): TimetableUpload {
  return TimetableUpload.parse({
    id: r.id,
    userId: r.user_id,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    status: r.status,
    method: r.method ?? null,
    errorCode: r.error_code ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  });
}

/** The caller's upload, or null when it does not exist or belongs to someone else (RLS). */
export async function loadUpload(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("timetable_uploads").select(UPLOAD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toTimetableUpload(data) : null;
}

/** Remove the stored file. Failures are logged and ignored; the row keeps its status. */
export async function removeStoredFile(supabase: SupabaseClient, storagePath: string) {
  const { error } = await supabase.storage.from("timetables").remove([storagePath]);
  if (error) console.warn(`[scheduler] could not remove a stored timetable: ${error.name}`);
}
