/**
 * Integration tests for the workout + reward services against the LOCAL
 * Supabase stack. Skipped automatically when .env.local / Supabase is absent
 * (e.g. the unit-test step in CI). Run locally: pnpm db:start && pnpm test
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
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

describe.skipIf(!enabled)("workout and reward services (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { startWorkout, completeWorkout, logManualWorkout } = await import("@/features/workouts/service");
  const { reconcileRewards } = await import("@/features/gamification/service");
  const admin = createAdminClient();
  let userId = "";
  let enrollmentId = "";
  let sessions: { id: string; week: number; day: number }[] = [];

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `itest-${Date.now()}@example.test`,
      password: "correct-horse-battery",
      email_confirm: true,
      user_metadata: { display_name: "Integration Runner" },
    });
    if (error) throw error;
    userId = data.user.id;
    const { data: p } = await admin
      .from("programmes")
      .select("id, programme_sessions(id, week, day)")
      .eq("slug", "couch-to-5k")
      .single();
    sessions = (p!.programme_sessions as typeof sessions).sort((a, b) => a.week - b.week || a.day - b.day);
    const { data: e, error: ee } = await admin
      .from("enrollments")
      .insert({ user_id: userId, programme_id: p!.id })
      .select("id")
      .single();
    if (ee) throw ee;
    enrollmentId = e!.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  const ledgerTotal = async () => {
    const { data } = await admin.from("xp_ledger").select("delta_xp, award_key").eq("user_id", userId);
    return { xp: (data ?? []).reduce((s, r) => s + r.delta_xp, 0), keys: (data ?? []).map((r) => r.award_key) };
  };

  it("start → complete persists one workout and awards XP once, even with concurrent duplicates", async () => {
    const { workoutId } = await startWorkout(
      userId,
      { kind: "programme", enrollmentId, sessionId: sessions[0].id },
      admin,
    );
    // Starting again returns the same in-progress workout.
    expect(
      (await startWorkout(userId, { kind: "programme", enrollmentId, sessionId: sessions[0].id }, admin)).workoutId,
    ).toBe(workoutId);

    const input = { durationMinutes: 30, distanceKm: 3, perceivedEffort: 5, notes: null, locationId: null };
    const results = await Promise.all([
      completeWorkout(userId, workoutId, input, admin),
      completeWorkout(userId, workoutId, input, admin),
      completeWorkout(userId, workoutId, input, admin),
    ]);
    expect(results.filter((r) => !r.alreadyCompleted)).toHaveLength(1);

    const { count } = await admin
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed");
    expect(count).toBe(1);
    const first = await ledgerTotal();
    expect(first.keys).toEqual(expect.arrayContaining([expect.stringMatching(/^workout:day:/), "badge:first-workout"]));
    expect(new Set(first.keys).size).toBe(first.keys.length);

    // Reconciling again pays nothing new.
    expect(await reconcileRewards(userId, admin)).toEqual([]);
    expect((await ledgerTotal()).xp).toBe(first.xp);
  });

  it("refuses to complete the same programme session twice", async () => {
    await expect(
      startWorkout(userId, { kind: "programme", enrollmentId, sessionId: sessions[0].id }, admin),
    ).rejects.toThrow(/already completed/);
  });

  it("treats a repeated manual entry with the same idempotency key as one workout", async () => {
    const entry = {
      title: "Evening walk",
      workoutType: "walk" as const,
      startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      durationMinutes: 40,
      distanceKm: 4,
      perceivedEffort: 3,
      notes: null,
      locationId: null,
      idempotencyKey: crypto.randomUUID(),
    };
    const [a, b] = await Promise.all([
      logManualWorkout(userId, entry, {}, admin),
      logManualWorkout(userId, entry, {}, admin),
    ]);
    expect(a.workoutId).toBe(b.workoutId);
    const { count } = await admin
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("idempotency_key", entry.idempotencyKey);
    expect(count).toBe(1);
  });

  it("rejects implausible manual entries", async () => {
    await expect(
      logManualWorkout(
        userId,
        {
          title: "Too fast",
          workoutType: "run",
          startedAt: new Date(Date.now() - 3_600_000).toISOString(),
          durationMinutes: 10,
          distanceKm: 10,
          perceivedEffort: null,
          notes: null,
          locationId: null,
          idempotencyKey: crypto.randomUUID(),
        },
        {},
        admin,
      ),
    ).rejects.toThrow(/pace/);
  });
});
