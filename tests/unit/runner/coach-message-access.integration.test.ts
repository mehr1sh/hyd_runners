/**
 * Coach and private-message access through the real Data API against the
 * LOCAL Supabase stack. Each person uses their own session and the
 * publishable key, exactly as the browser can, and tries the direct table,
 * embedded-resource and RPC paths. Skipped when .env.local / local Supabase
 * is absent. Run locally: pnpm db:start && pnpm test
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
const PEOPLE = ["runner", "other", "coach", "revoked", "manager", "admin"] as const;
type Person = (typeof PEOPLE)[number];

describe.skipIf(!enabled)("coach and message access (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { listMessages, listRecipients, revokeStaffRole } = await import("@/features/community/service");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids = {} as Record<Person, string>;
  const clients = {} as Record<Person, SupabaseClient>;
  const email = (who: Person) => `itest-access-${who}-${stamp}@example.test`;

  async function signIn(who: Person): Promise<SupabaseClient> {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await client.auth.signInWithPassword({ email: email(who), password: PASSWORD });
    if (error) throw error;
    return client;
  }
  const bodiesSeenBy = async (who: Person) => {
    const { data, error } = await clients[who].from("messages").select("body").like("body", `%${stamp}%`);
    if (error) throw error;
    return (data ?? []).map((row) => row.body).sort();
  };

  beforeAll(async () => {
    for (const who of PEOPLE) {
      const { data, error } = await admin.auth.admin.createUser({
        email: email(who),
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Access ${who} ${stamp}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
    }
    const { error: roleError } = await admin.from("user_roles").insert([
      { user_id: ids.coach, role: "coach" },
      { user_id: ids.revoked, role: "coach" },
      { user_id: ids.manager, role: "programme_manager" },
      { user_id: ids.admin, role: "admin" },
    ]);
    if (roleError) throw roleError;
    const { error: assignError } = await admin.from("coach_assignments").insert([
      { coach_id: ids.coach, runner_id: ids.runner },
      { coach_id: ids.revoked, runner_id: ids.runner },
    ]);
    if (assignError) throw assignError;
    const { error: feedbackError } = await admin.from("feedback").insert({
      user_id: ids.runner,
      target: "app",
      body: `Assigned to the revoked coach ${stamp}`,
      barrier: "other",
      assigned_to: ids.revoked,
    });
    if (feedbackError) throw feedbackError;
    const { error: messageError } = await admin.from("messages").insert([
      { sender_id: ids.coach, recipient_id: ids.runner, body: `coach to runner ${stamp}` },
      { sender_id: ids.revoked, recipient_id: ids.runner, body: `revoked to runner ${stamp}` },
      { sender_id: ids.runner, recipient_id: ids.revoked, body: `runner to revoked ${stamp}` },
    ]);
    if (messageError) throw messageError;
    for (const who of PEOPLE) clients[who] = await signIn(who);

    // The manager revokes the coach role through the app's own service.
    const revoked = await revokeStaffRole(clients.manager, ids.manager, ids.revoked, "coach");
    if (!revoked.ok) throw new Error(revoked.message);
  });

  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("lets only the two participants read a conversation", async () => {
    expect(await bodiesSeenBy("runner")).toEqual(
      [`coach to runner ${stamp}`, `revoked to runner ${stamp}`, `runner to revoked ${stamp}`].sort(),
    );
    expect(await bodiesSeenBy("coach")).toEqual([`coach to runner ${stamp}`]);
    expect(await bodiesSeenBy("other")).toEqual([]);
    expect(await bodiesSeenBy("manager")).toEqual([]);
    expect(await bodiesSeenBy("admin")).toEqual([]);
  });

  it("keeps the revoked coach's history but nothing else", async () => {
    expect(await bodiesSeenBy("revoked")).toEqual([`revoked to runner ${stamp}`, `runner to revoked ${stamp}`].sort());
    const profile = await clients.revoked.from("profiles").select("id").eq("id", ids.runner);
    expect(profile.data).toEqual([]);
    const prefs = await clients.revoked.from("user_preferences").select("user_id").eq("user_id", ids.runner);
    expect(prefs.data).toEqual([]);
    const feedback = await clients.revoked.from("feedback").select("id").like("body", `%${stamp}%`);
    expect(feedback.data).toEqual([]);
    const assignments = await admin.from("coach_assignments").select("id").eq("coach_id", ids.revoked);
    expect(assignments.data).toEqual([]);
    const returned = await admin.from("feedback").select("assigned_to").like("body", `%${stamp}%`).single();
    expect(returned.data?.assigned_to).toBeNull();
  });

  it("blocks sending to and from a revoked coach", async () => {
    const out = await clients.revoked
      .from("messages")
      .insert({ sender_id: ids.revoked, recipient_id: ids.runner, body: `blocked ${stamp}` });
    expect(out.error?.code).toBe("42501");
    const back = await clients.runner
      .from("messages")
      .insert({ sender_id: ids.runner, recipient_id: ids.revoked, body: `blocked ${stamp}` });
    expect(back.error?.code).toBe("42501");
  });

  it("does not leak messages through embedded resources", async () => {
    // A manager can read every profile, so this is the widest embed available.
    const { data, error } = await clients.manager
      .from("profiles")
      .select("id, sent:messages!messages_sender_id_fkey(body), received:messages!messages_recipient_id_fkey(body)")
      .in("id", [ids.runner, ids.coach, ids.revoked]);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.sent).toEqual([]);
      expect(row.received).toEqual([]);
    }
  });

  it("offers runners only their active coach through the recipient RPC and the app service", async () => {
    const recipients = await listRecipients(clients.runner);
    expect(recipients.ok).toBe(true);
    const mine = recipients.ok ? recipients.data.filter((p) => Object.values(ids).includes(p.id)) : [];
    expect(mine.map((p) => p.id)).toEqual([ids.coach]);

    const revokedView = await listRecipients(clients.revoked);
    expect(revokedView.ok && revokedView.data.some((p) => p.id === ids.runner)).toBe(false);
  });

  it("returns only the manager's own conversations from the app service", async () => {
    const sent = await clients.manager
      .from("messages")
      .insert({ sender_id: ids.manager, recipient_id: ids.other, body: `manager to other ${stamp}` });
    expect(sent.error).toBeNull();
    const listed = await listMessages(clients.manager, ids.manager);
    expect(listed.ok).toBe(true);
    const ours = listed.ok ? listed.data.filter((m) => (m.body ?? "").includes(String(stamp))) : [];
    expect(ours.map((m) => m.body)).toEqual([`manager to other ${stamp}`]);

    // The runner who was written to may now reply.
    const reply = await clients.other
      .from("messages")
      .insert({ sender_id: ids.other, recipient_id: ids.manager, body: `other to manager ${stamp}` });
    expect(reply.error).toBeNull();
  });
});
