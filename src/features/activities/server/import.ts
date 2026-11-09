import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileRewards } from "@/features/gamification/service";
import { ActivityValidationError, normalizeActivity, type ActivityType } from "../logic/normalize";
import { MAX_ACTIVITY_FILE_BYTES, parseActivityFile } from "../logic/parse";

export const BUCKET = "activity-files";
export const storagePathFor = (userId: string, activityId: string) => `${userId}/${activityId}`;

export type ImportResult =
  | { status: "ready"; activityId: string; linkedExisting: boolean }
  | { status: "duplicate"; activityId: string; duplicateOf: string }
  | { status: "failed"; activityId: string; reason: string; retryable: boolean }
  | { status: "processing"; activityId: string };

/** Register an upload and return a one-time signed URL for the private bucket. */
export async function registerUpload(
  supabase: SupabaseClient,
  userId: string,
  input: {
    activityType: ActivityType;
    visibility: "private" | "followers" | "public";
    sizeBytes: number;
    name: string | null;
  },
) {
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ACTIVITY_FILE_BYTES) {
    return {
      ok: false as const,
      code: "payload_too_large" as const,
      message: "Activity files must be 15 MB or smaller.",
    };
  }
  const { data, error } = await supabase
    .from("activities")
    .insert({ user_id: userId, activity_type: input.activityType, visibility: input.visibility, name: input.name })
    .select("id")
    .single();
  if (error) return { ok: false as const, error };
  const path = storagePathFor(userId, data.id as string);
  const signed = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) {
    await supabase.from("activities").delete().eq("id", data.id);
    return { ok: false as const, error: { code: "storage", message: signed.error.message } };
  }
  return {
    ok: true as const,
    activityId: data.id as string,
    uploadUrl: signed.data.signedUrl,
    token: signed.data.token,
    path,
  };
}

const toWkt = (coords: [number, number][]) =>
  `SRID=4326;LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;

/**
 * Parse, validate and store an uploaded activity. Safe to call repeatedly:
 * only one call can claim an activity, ready activities return immediately,
 * and validation failures are final (the file is removed).
 */
export async function processActivity(
  userId: string,
  activityId: string,
  admin = createAdminClient(),
): Promise<ImportResult> {
  // Claim the activity (uploaded, retryable failure, or a stale processing claim).
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("activities")
    .update({ status: "processing", failure_reason: null })
    .eq("id", activityId)
    .eq("user_id", userId)
    .or(
      `status.eq.uploaded,and(status.eq.failed,failure_reason.eq.internal),and(status.eq.processing,updated_at.lt.${staleBefore})`,
    )
    .select("id, privacy_trim_m")
    .maybeSingle();
  if (claimError) throw new Error(`Could not claim the activity: ${claimError.message}`);
  if (!claimed) {
    const { data: row } = await admin
      .from("activities")
      .select("status, failure_reason")
      .eq("id", activityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) return { status: "failed", activityId, reason: "Activity not found.", retryable: false };
    if (row.status === "ready") return { status: "ready", activityId, linkedExisting: false };
    if (row.status === "processing") return { status: "processing", activityId };
    const reason = String(row.failure_reason ?? "");
    if (reason.startsWith("duplicate:")) return { status: "duplicate", activityId, duplicateOf: reason.slice(10) };
    return { status: "failed", activityId, reason, retryable: false };
  }

  const path = storagePathFor(userId, activityId);
  // A final failure removes the upload entirely (the importer shows why);
  // only unexpected errors keep the row and file so the runner can retry.
  const fail = async (reason: string, retryable: boolean): Promise<ImportResult> => {
    if (retryable) {
      await admin.from("activities").update({ status: "failed", failure_reason: "internal" }).eq("id", activityId);
    } else {
      await admin.storage.from(BUCKET).remove([path]);
      await admin.from("activities").delete().eq("id", activityId).eq("user_id", userId);
    }
    return {
      status: "failed",
      activityId,
      reason: retryable ? "Something went wrong while processing. Try again." : reason,
      retryable,
    };
  };

  const download = await admin.storage.from(BUCKET).download(path);
  if (download.error || !download.data) return fail("The uploaded file was not found. Upload it again.", false);
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let normalized;
  let parsed;
  try {
    parsed = await parseActivityFile(bytes);
    normalized = normalizeActivity(parsed, { trimMeters: claimed.privacy_trim_m as number });
  } catch (e) {
    if (e instanceof ActivityValidationError) return fail(e.message, false);
    console.error("[activities] parse failed", e instanceof Error ? e.name : e);
    return fail("internal", true);
  }

  const { data: result, error } = await admin.rpc("finalize_activity_import", {
    p_activity_id: activityId,
    p_payload: {
      ...normalized,
      format: parsed.format,
      name: parsed.name,
      sha256,
      filePath: path,
      fileBytes: bytes.length,
      pathWkt: normalized.path ? toWkt(normalized.path) : null,
      publicPathWkt: normalized.publicPath ? toWkt(normalized.publicPath) : null,
      path: undefined,
      publicPath: undefined,
    },
  });
  if (error) {
    console.error("[activities] finalize failed", error.code);
    return fail("internal", true);
  }
  const outcome = result as { status: string; duplicateOf?: string; linkedExisting?: boolean };
  if (outcome.status === "duplicate") {
    await admin.storage.from(BUCKET).remove([path]);
    await admin.from("activities").delete().eq("id", activityId).eq("user_id", userId);
    return { status: "duplicate", activityId, duplicateOf: outcome.duplicateOf ?? "" };
  }
  try {
    await reconcileRewards(userId, admin);
  } catch (e) {
    console.error("[activities] reward reconciliation failed", e instanceof Error ? e.name : e);
  }
  return { status: "ready", activityId, linkedExisting: Boolean(outcome.linkedExisting) };
}

/** Delete an activity, its stored file, and the workout log the import created (not a manual one). */
export async function deleteActivity(supabase: SupabaseClient, userId: string, activityId: string) {
  const { data: row, error } = await supabase
    .from("activities")
    .select("id, workout_log_id")
    .eq("id", activityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return false;
  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([storagePathFor(userId, activityId)]);
  const { error: deleteError } = await supabase.from("activities").delete().eq("id", activityId);
  if (deleteError) throw new Error(deleteError.message);
  if (row.workout_log_id) {
    await admin.from("workout_logs").delete().eq("id", row.workout_log_id).eq("user_id", userId).eq("source", "import");
  }
  return true;
}
