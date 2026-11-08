/**
 * Coach-led enrolment approval through the real Data API against the LOCAL
 * Supabase stack: runners use their own session and the publishable key, as
 * the browser can. Skipped when .env.local / local Supabase is absent.
 * Run locally: pnpm db:start && pnpm test
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

describe.skipIf(!enabled)("coach-led enrolment approval (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { listEnrollmentRequests, reviewEnrollment } = await import("@/features/workouts/enrollment-requests");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids: Record<"runner" | "coach" | "former", string> = { runner: "", coach: "", former: "" };
  let programmeId = "";

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    return client;
  }
  const email = (who: string) => `itest-enrol-${who}-${stamp}@example.test`;
  const statusOf = async (id: string) =>
    (await admin.from("enrollments").select("status").eq("id", id).single()).data?.status;

  beforeAll(async () => {
    for (const who of Object.keys(ids) as (keyof typeof ids)[]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: email(who),
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Enrol ${who} ${stamp}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
    }
    await admin.from("user_roles").insert([
      { user_id: ids.coach, role: "coach" },
      { user_id: ids.former, role: "coach" },
    ]);
    const { error: assignError } = await admin.from("coach_assignments").insert([
      { coach_id: ids.coach, runner_id: ids.runner },
      { coach_id: ids.former, runner_id: ids.runner },
    ]);
    if (assignError) throw assignError;
    // The former coach loses the role but keeps the assignment row.
    await admin.from("user_roles").delete().eq("user_id", ids.former).eq("role", "coach");
    const { data: programme } = await admin.from("programmes").select("id").eq("slug", "training-and-shine").single();
    programmeId = programme!.id;
  });

  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("stops a runner approving their own request in one step or two", async () => {
    const runner = await signIn(email("runner"));
    const { error: insertError } = await runner
      .from("enrollments")
      .insert({ user_id: ids.runner, programme_id: programmeId });
    expect(insertError).toBeNull();
    const { data: own } = await runner
      .from("enrollments")
      .select("id, status")
      .eq("programme_id", programmeId)
      .single();
    expect(own?.status).toBe("requested");

    const direct = await runner.from("enrollments").update({ status: "active" }).eq("id", own!.id);
    expect(direct.error?.code).toBe("42501");
    const pause = await runner.from("enrollments").update({ status: "paused" }).eq("id", own!.id);
    expect(pause.error?.code).toBe("42501");
    const forged = await runner
      .from("enrollments")
      .insert({ user_id: ids.runner, programme_id: programmeId, coach_id: ids.runner });
    expect(forged.error?.code).toBe("42501");
    expect(await statusOf(own!.id)).toBe("requested");

    // Only status is writable: other fields are refused, with or without a status change.
    for (const change of [
      { coach_id: ids.coach },
      { started_at: new Date(Date.now() - 30 * 86_400_000).toISOString() },
      { user_id: ids.coach },
      { status: "withdrawn", completed_at: new Date().toISOString() },
    ]) {
      const { error } = await runner.from("enrollments").update(change).eq("id", own!.id);
      expect(error?.code, JSON.stringify(change)).toBe("42501");
    }
    const { data: unchanged } = await admin
      .from("enrollments")
      .select("user_id, coach_id, started_at, completed_at, status")
      .eq("id", own!.id)
      .single();
    expect(unchanged).toEqual({
      user_id: ids.runner,
      coach_id: null,
      started_at: null,
      completed_at: null,
      status: "requested",
    });
  });

  it("lets only the current assigned coach approve it", async () => {
    const former = await signIn(email("former"));
    expect(await listEnrollmentRequests(former, ids.former)).toEqual([]);
    const { data: own } = await admin
      .from("enrollments")
      .select("id")
      .eq("user_id", ids.runner)
      .eq("status", "requested")
      .single();
    expect(await reviewEnrollment(former, own!.id, "approve")).toEqual({
      ok: false,
      message: "This request has already been handled.",
    });
    expect(await statusOf(own!.id)).toBe("requested");

    const coach = await signIn(email("coach"));
    // The coach cannot set the approval fields themselves.
    const backdated = await coach
      .from("enrollments")
      .update({ status: "active", started_at: new Date(Date.now() - 30 * 86_400_000).toISOString() })
      .eq("id", own!.id);
    expect(backdated.error?.code).toBe("42501");
    expect(await statusOf(own!.id)).toBe("requested");
    const requests = await listEnrollmentRequests(coach, ids.coach);
    expect(requests).toEqual([
      expect.objectContaining({
        id: own!.id,
        runnerName: `Enrol runner ${stamp}`,
        programmeSlug: "training-and-shine",
      }),
    ]);
    expect(await reviewEnrollment(coach, own!.id, "approve")).toEqual({ ok: true });
    const { data: approved } = await admin
      .from("enrollments")
      .select("status, coach_id, started_at")
      .eq("id", own!.id)
      .single();
    expect(approved).toMatchObject({ status: "active", coach_id: ids.coach });
    expect(approved?.started_at).not.toBeNull();

    // A second decision on the same request changes nothing.
    expect(await reviewEnrollment(coach, own!.id, "decline")).toEqual({
      ok: false,
      message: "This request has already been handled.",
    });
    expect(await statusOf(own!.id)).toBe("active");
  });

  it("keeps the runner's pause, resume and leave working", async () => {
    const runner = await signIn(email("runner"));
    const { data: own } = await runner
      .from("enrollments")
      .select("id")
      .eq("status", "active")
      .eq("programme_id", programmeId)
      .single();
    for (const status of ["paused", "active", "withdrawn"] as const) {
      const { error } = await runner.from("enrollments").update({ status }).eq("id", own!.id);
      expect(error).toBeNull();
      expect(await statusOf(own!.id)).toBe(status);
    }
  });
});
