/**
 * Per-user rate limits and timezone validation through the app's own
 * services against the LOCAL Supabase stack, including concurrent bursts.
 * Skipped when .env.local / local Supabase is absent.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isLocalSupabaseUrl } from "../local-supabase";

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

describe.skipIf(!enabled)("rate limits and timezone validation (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { sendMessage } = await import("@/features/community/service");
  const { logManualWorkout, WorkoutError } = await import("@/features/workouts/service");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids = { manager: "", runner: "" };
  let manager: SupabaseClient;
  let runner: SupabaseClient;
  const email = (who: string) => `itest-limits-${who}-${stamp}@example.test`;

  async function signIn(who: string) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await client.auth.signInWithPassword({ email: email(who), password: PASSWORD });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    for (const who of ["manager", "runner"] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email: email(who),
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Limits ${who} ${stamp}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
    }
    const { error } = await admin.from("user_roles").insert({ user_id: ids.manager, role: "programme_manager" });
    if (error) throw error;
    manager = await signIn("manager");
    runner = await signIn("runner");
  });

  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("accepts exactly 20 of 25 concurrent messages and explains the refusal", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => sendMessage(manager, ids.manager, ids.runner, `burst ${i} ${stamp}`)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(5);
    expect(refused[0]).toMatchObject({ code: "rate_limited", message: expect.stringMatching(/wait a few minutes/) });
    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", ids.manager);
    expect(count).toBe(20);
  });

  it("limits workouts saved with the secret key to 10 per runner in ten minutes, even in parallel", async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        logManualWorkout(
          ids.runner,
          {
            title: `Limit walk ${i}`,
            workoutType: "walk",
            startedAt: new Date(Date.now() - (i + 2) * 3_600_000).toISOString(),
            durationMinutes: 20,
            distanceKm: 2,
            perceivedEffort: 3,
            notes: null,
            locationId: null,
            idempotencyKey: crypto.randomUUID(),
          },
          { reconcile: false },
          admin,
        ),
      ),
    );
    const saved = settled.filter((r) => r.status === "fulfilled");
    const limited = settled.filter(
      (r) => r.status === "rejected" && r.reason instanceof WorkoutError && r.reason.code === "rate_limited",
    );
    expect(saved).toHaveLength(10);
    expect(limited).toHaveLength(2);
  });

  it("rejects an unknown timezone on the profile and keeps a valid one", async () => {
    const bad = await runner.from("profiles").update({ timezone: "Mars/Olympus_Mons" }).eq("id", ids.runner);
    expect(bad.error?.code).toBe("22023");
    const good = await runner.from("profiles").update({ timezone: "Asia/Tokyo" }).eq("id", ids.runner);
    expect(good.error).toBeNull();
  });
});
