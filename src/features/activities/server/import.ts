import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileRewards } from "@/features/gamification/service";
import { ActivityValidationError, normalizeActivity, type ActivityType, type ParsedActivity } from "../logic/normalize";
import { MAX_ACTIVITY_FILE_BYTES, parseActivityFile } from "../logic/parse";
import { canonicalRecording, recordedToParsed, type RecordedActivityInput } from "../logic/recorded";

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

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Claim an activity for processing (uploaded, retryable failure, or a stale
 * processing claim). When it cannot be claimed, the current outcome is
 * returned instead.
 */
async function claimActivity(
  admin: Admin,
  userId: string,
  activityId: string,
): Promise<{ claimed: { privacy_trim_m: number } } | { outcome: ImportResult }> {
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
  if (claimed) return { claimed: { privacy_trim_m: claimed.privacy_trim_m as number } };
  const { data: row } = await admin
    .from("activities")
    .select("status, failure_reason")
    .eq("id", activityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { outcome: { status: "failed", activityId, reason: "Activity not found.", retryable: false } };
  if (row.status === "ready") return { outcome: { status: "ready", activityId, linkedExisting: false } };
  if (row.status === "processing") return { outcome: { status: "processing", activityId } };
  const reason = String(row.failure_reason ?? "");
  if (reason.startsWith("duplicate:"))
    return { outcome: { status: "duplicate", activityId, duplicateOf: reason.slice(10) } };
  return { outcome: { status: "failed", activityId, reason, retryable: false } };
}

/**
 * A final failure removes the upload entirely (the importer shows why); only
 * unexpected errors keep the row and file so the runner can retry.
 */
function failer(admin: Admin, userId: string, activityId: string) {
  const path = storagePathFor(userId, activityId);
  return async (reason: string, retryable: boolean): Promise<ImportResult> => {
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
}

/** Normalise parsed samples and store them through finalize_activity_import(). */
async function finalizeParsed(
  admin: Admin,
  userId: string,
  activityId: string,
  trimMeters: number,
  produce: () => Promise<{ parsed: ParsedActivity; bytes: Uint8Array }>,
): Promise<ImportResult> {
  const path = storagePathFor(userId, activityId);
  const fail = failer(admin, userId, activityId);

  let normalized;
  let parsed;
  let bytes;
  try {
    ({ parsed, bytes } = await produce());
    normalized = normalizeActivity(parsed, { trimMeters });
  } catch (e) {
    if (e instanceof ActivityValidationError) return fail(e.message, false);
    console.error("[activities] parse failed", e instanceof Error ? e.name : e);
    return fail("internal", true);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

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
  const claim = await claimActivity(admin, userId, activityId);
  if ("outcome" in claim) return claim.outcome;

  const download = await admin.storage.from(BUCKET).download(storagePathFor(userId, activityId));
  if (download.error || !download.data) {
    return failer(admin, userId, activityId)("The uploaded file was not found. Upload it again.", false);
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  return finalizeParsed(admin, userId, activityId, claim.claimed.privacy_trim_m, async () => ({
    parsed: await parseActivityFile(bytes),
    bytes,
  }));
}

export type RecordedResult = ImportResult & { created: boolean };

/**
 * Store a run recorded by the mobile app. Idempotent per (runner, clientRef):
 * a retry of a stored recording returns the existing activity; a retry of an
 * unfinished one (lost response, crash mid-request) finishes it. The row is
 * inserted as the runner (RLS and the upload rate limit apply); only the
 * metrics are written by the service role, exactly as for file imports.
 */
export async function importRecordedActivity(
  supabase: SupabaseClient,
  userId: string,
  input: RecordedActivityInput,
  admin = createAdminClient(),
): Promise<RecordedResult> {
  const findExisting = async () => {
    const { data, error } = await supabase
      .from("activities")
      .select("id")
      .eq("user_id", userId)
      .eq("client_ref", input.clientRef)
      .maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  };

  let created = false;
  let activityId = await findExisting();
  if (!activityId) {
    const { data, error } = await supabase
      .from("activities")
      .insert({
        user_id: userId,
        activity_type: input.activityType,
        visibility: "private",
        name: input.name || null,
        client_ref: input.clientRef,
        import_source: "app",
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      // A concurrent request with the same clientRef won the insert.
      activityId = await findExisting();
      if (!activityId) throw error;
    } else if (error) {
      throw error;
    } else {
      activityId = data.id as string;
      created = true;
    }
  }

  const claim = await claimActivity(admin, userId, activityId);
  if ("outcome" in claim) return { ...claim.outcome, created };

  const bytes = canonicalRecording(input);
  const stored = await admin.storage
    .from(BUCKET)
    .upload(storagePathFor(userId, activityId), new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      contentType: "application/json",
      upsert: true,
    });
  if (stored.error) {
    console.error("[activities] storing recording failed", stored.error.name);
    return { ...(await failer(admin, userId, activityId)("internal", true)), created };
  }
  const result = await finalizeParsed(admin, userId, activityId, claim.claimed.privacy_trim_m, async () => ({
    parsed: recordedToParsed(input),
    bytes,
  }));
  return { ...result, created };
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
