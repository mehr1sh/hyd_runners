// @vitest-environment node
/**
 * The GPX/FIT import pipeline end to end against the LOCAL Supabase stack:
 * register, upload to the signed URL, process (concurrently), duplicates,
 * malformed files, rewards and privacy. Skipped without local Supabase.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isLocalSupabaseUrl } from "../local-supabase";
import { fit, gpx, track } from "../activities/fixtures";

vi.mock("server-only", () => ({}));

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no local env */
  }
  return isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SECRET_KEY);
}

const enabled = loadEnv();
async function reachable() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

const PASSWORD = "correct-horse-battery";

describe.skipIf(!enabled)("activity import pipeline (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { registerUpload, processActivity, deleteActivity, BUCKET, storagePathFor } =
    await import("@/features/activities/server/import");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids = { runner: "", other: "" };
  const clients = {} as Record<"runner" | "other", SupabaseClient>;

  beforeAll(async () => {
    for (const who of ["runner", "other"] as const) {
      const email = `itest-activities-${who}-${stamp}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Act ${who}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
      const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      if (e2) throw e2;
      clients[who] = c;
    }
  });
  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  async function upload(bytes: Uint8Array, visibility: "private" | "public" = "private") {
    const reg = await registerUpload(clients.runner, ids.runner, {
      activityType: "run",
      visibility,
      sizeBytes: bytes.length,
      name: null,
    });
    if (!reg.ok) throw new Error(JSON.stringify(reg));
    const put = await clients.runner.storage
      .from(BUCKET)
      .uploadToSignedUrl(reg.path, reg.token, new Blob([bytes as Uint8Array<ArrayBuffer>]));
    if (put.error) throw put.error;
    return reg.activityId;
  }

  const runFile = fit(
    track({ start: new Date("2026-11-03T00:45:00Z"), seconds: 1500, speedMs: 3.1, ele: (i) => 520 + (i % 20) }),
  );

  it("imports a FIT file once even when processing is triggered concurrently", async () => {
    const id = await upload(runFile, "public");
    const results = await Promise.all([
      processActivity(ids.runner, id, admin),
      processActivity(ids.runner, id, admin),
      processActivity(ids.runner, id, admin),
    ]);
    expect(results.filter((r) => r.status === "ready").length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === "ready" || r.status === "processing")).toBe(true);
    const { data: a } = await admin
      .from("activities")
      .select("status, distance_m, km_splits, workout_log_id, source_format")
      .eq("id", id)
      .single();
    expect(a).toMatchObject({ status: "ready", source_format: "fit" });
    expect(Number(a!.distance_m)).toBeGreaterThan(4600);
    expect((a!.km_splits as unknown[]).length).toBeGreaterThanOrEqual(4);
    const { count } = await admin
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ids.runner);
    expect(count).toBe(1);
    const xp = await admin.from("xp_ledger").select("award_key").eq("user_id", ids.runner);
    expect((xp.data ?? []).length).toBeGreaterThan(0);
    // Processing again changes nothing.
    expect(await processActivity(ids.runner, id, admin)).toMatchObject({ status: "ready" });
    const again = await admin.from("xp_ledger").select("award_key").eq("user_id", ids.runner);
    expect(again.data!.length).toBe(xp.data!.length);
  });

  it("refuses a second copy of the same run and removes its file", async () => {
    const id = await upload(runFile);
    const result = await processActivity(ids.runner, id, admin);
    expect(result.status).toBe("duplicate");
    const listed = await admin.storage.from(BUCKET).list(ids.runner);
    expect((listed.data ?? []).some((f) => f.name === id)).toBe(false);
  });

  it("explains why a malformed file failed and does not retry it forever", async () => {
    const id = await upload(
      new TextEncoder().encode(gpx([]).replace("<trkseg></trkseg>", "<trkseg><trkpt lat='17.4' lon='78.4'/></trkseg>")),
    );
    const result = await processActivity(ids.runner, id, admin);
    expect(result).toMatchObject({ status: "failed", retryable: false });
    // The failed upload is removed, so processing it again finds nothing.
    expect(await processActivity(ids.runner, id, admin)).toMatchObject({
      status: "failed",
      reason: "Activity not found.",
    });
  });

  it("keeps files, tracks and private activities away from other runners", async () => {
    const id = await upload(fit(track({ start: new Date("2026-11-04T01:00:00Z"), seconds: 900, speedMs: 3 })));
    expect((await processActivity(ids.runner, id, admin)).status).toBe("ready");
    const seen = await clients.other.from("activities").select("id, status").eq("user_id", ids.runner);
    expect((seen.data ?? []).every((a) => a.status === "ready")).toBe(true);
    expect((seen.data ?? []).some((a) => a.id === id)).toBe(false);
    const tracks = await clients.other.from("activity_tracks").select("activity_id").eq("user_id", ids.runner);
    expect(tracks.data).toEqual([]);
    const file = await clients.other.storage.from(BUCKET).download(storagePathFor(ids.runner, id));
    expect(file.error).not.toBeNull();
    // Others cannot process someone else's upload.
    expect(await processActivity(ids.other, id, admin)).toMatchObject({
      status: "failed",
      reason: "Activity not found.",
    });
  });

  it("deletes an activity with its file and the log the import created", async () => {
    const id = await upload(
      new TextEncoder().encode(gpx(track({ start: new Date("2026-11-05T01:00:00Z"), seconds: 700, speedMs: 3 }))),
    );
    expect((await processActivity(ids.runner, id, admin)).status).toBe("ready");
    const { data: before } = await admin.from("activities").select("workout_log_id").eq("id", id).single();
    expect(await deleteActivity(clients.runner, ids.runner, id)).toBe(true);
    expect((await admin.from("activities").select("id").eq("id", id)).data).toEqual([]);
    expect((await admin.from("workout_logs").select("id").eq("id", before!.workout_log_id)).data).toEqual([]);
  });
});
