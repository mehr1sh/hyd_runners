// @vitest-environment node
/**
 * POST /api/v1/activities/recorded end to end against the LOCAL Supabase stack:
 * bearer auth, idempotency per clientRef (sequential and concurrent retries),
 * per-runner scoping, duplicate detection against a file import, and
 * validation failures. Skipped without local Supabase.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isLocalSupabaseUrl } from "../local-supabase";
import { track } from "../activities/fixtures";

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

describe.skipIf(!enabled)("recorded activities API (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { POST } = await import("@/app/api/v1/activities/recorded/route");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids = { runner: "", other: "" };
  const tokens = { runner: "", other: "" };

  beforeAll(async () => {
    for (const who of ["runner", "other"] as const) {
      const email = `itest-recorded-${who}-${stamp}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Rec ${who}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
      const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      if (e2) throw e2;
      tokens[who] = s.session!.access_token;
    }
  });
  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  function recording(start: string, clientRef = randomUUID(), seconds = 1200) {
    return {
      clientRef,
      activityType: "run",
      points: track({ start: new Date(start), seconds, speedMs: 3, ele: () => 510 }).map((p) => ({
        t: p.t.toISOString(),
        lat: p.lat,
        lon: p.lon,
        ele: p.ele,
        acc: 6,
      })),
      pauses: [],
    };
  }

  async function post(body: unknown, token: string = tokens.runner) {
    const res = await POST(
      new Request("http://localhost/api/v1/activities/recorded", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    return {
      status: res.status,
      json: (await res.json()) as { data?: Record<string, unknown>; error?: { code: string } },
    };
  }

  it("requires a valid bearer token", async () => {
    // (Without any header the route falls back to the web cookie session.)
    const r = await post(recording("2026-11-04T00:30:00Z"), "not-a-jwt");
    expect(r.status).toBe(401);
  });

  it("stores a recording once and returns the same activity on retry", async () => {
    const body = recording("2026-11-04T00:30:00Z");
    const first = await post(body);
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({ status: "ready", created: true });
    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ status: "ready", created: false, activityId: first.json.data!.activityId });

    const { data: rows } = await admin
      .from("activities")
      .select("id, status, source_format, import_source, client_ref, distance_m, moving_source, workout_log_id")
      .eq("user_id", ids.runner)
      .eq("client_ref", body.clientRef);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ status: "ready", source_format: "app", import_source: "app" });
    expect(Number(rows![0].distance_m)).toBeGreaterThan(3500);
    expect(rows![0].workout_log_id).not.toBeNull();
    const { data: track } = await admin
      .from("activity_tracks")
      .select("file_path")
      .eq("activity_id", rows![0].id)
      .single();
    expect(track!.file_path).toBe(`${ids.runner}/${rows![0].id}`);
  });

  it("inserts once when the same recording is retried concurrently", async () => {
    const body = recording("2026-11-05T00:30:00Z");
    const results = await Promise.all([post(body), post(body), post(body)]);
    expect(results.every((r) => [200, 201, 202].includes(r.status))).toBe(true);
    const { count } = await admin
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ids.runner)
      .eq("client_ref", body.clientRef);
    expect(count).toBe(1);
  });

  it("scopes client references per runner", async () => {
    const body = recording("2026-11-06T00:30:00Z");
    expect((await post(body)).status).toBe(201);
    const other = await post(body, tokens.other);
    expect(other.status).toBe(201);
    expect(other.json.data!.activityId).not.toBe((await post(body)).json.data!.activityId);
  });

  it("reports a recording of an already stored run as a duplicate", async () => {
    const first = await post(recording("2026-11-07T00:30:00Z"));
    const dup = await post(recording("2026-11-07T00:30:00Z"));
    expect(dup.status).toBe(200);
    expect(dup.json.data).toMatchObject({ status: "duplicate", activityId: first.json.data!.activityId });
  });

  it("rejects invalid bodies and recordings that are too short", async () => {
    expect((await post({ clientRef: "nope", points: [] })).status).toBe(422);
    const short = recording("2026-11-08T00:30:00Z", randomUUID(), 30);
    const r = await post(short);
    expect(r.status).toBe(422);
    const { count } = await admin
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("client_ref", short.clientRef);
    expect(count).toBe(0);
  });
});
