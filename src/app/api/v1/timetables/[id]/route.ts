import { Id } from "@/lib/contracts";
import { fail, ok } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { loadUpload, removeStoredFile } from "@/features/scheduler/server/uploads";

/** DELETE /api/v1/timetables/:id — remove the stored file and its record. Confirmed availability is kept. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/timetables/[id]">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.caller;

  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return fail("not_found", "Timetable not found.");
  try {
    const upload = await loadUpload(supabase, id.data);
    if (!upload) return fail("not_found", "Timetable not found.");
    await removeStoredFile(supabase, upload.storagePath);
    const { error } = await supabase.from("timetable_uploads").delete().eq("id", upload.id);
    if (error) throw error;
    return ok({ deleted: true });
  } catch (error) {
    return internalError("delete timetable", error);
  }
}
