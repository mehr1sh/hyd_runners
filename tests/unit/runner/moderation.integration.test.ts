/**
 * Reports, moderation and the audit log through the real Data API against
 * the LOCAL Supabase stack, using each person's own session. Includes a
 * concurrent burst to prove the per-user rate limit holds under parallel
 * requests. Skipped when .env.local / local Supabase is absent.
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
const PEOPLE = ["runner", "sender", "moderator", "admin"] as const;
type Person = (typeof PEOPLE)[number];

describe.skipIf(!enabled)("reports, moderation and audit log (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { reportContent, viewReportedContent, resolveReport, listReportQueue, listAuditLog } =
    await import("@/features/community/moderation");
  const { listMessages } = await import("@/features/community/service");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids = {} as Record<Person, string>;
  const clients = {} as Record<Person, SupabaseClient>;
  const email = (who: Person) => `itest-moderation-${who}-${stamp}@example.test`;
  let abusiveId = "";
  const burstIds: string[] = [];

  beforeAll(async () => {
    for (const who of PEOPLE) {
      const { data, error } = await admin.auth.admin.createUser({
        email: email(who),
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Moderation ${who} ${stamp}` },
      });
      if (error) throw error;
      ids[who] = data.user.id;
    }
    const { error: roleError } = await admin.from("user_roles").insert([
      { user_id: ids.sender, role: "programme_manager" },
      { user_id: ids.moderator, role: "programme_manager" },
      { user_id: ids.admin, role: "admin" },
    ]);
    if (roleError) throw roleError;
    const rows = [
      { sender_id: ids.sender, recipient_id: ids.runner, body: `abusive ${stamp}` },
      ...Array.from({ length: 14 }, (_, i) => ({
        sender_id: ids.sender,
        recipient_id: ids.runner,
        body: `burst ${i} ${stamp}`,
      })),
    ];
    const { data, error } = await admin.from("messages").insert(rows).select("id, body");
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.body.startsWith("abusive")) abusiveId = row.id;
      else burstIds.push(row.id);
    }
    for (const who of PEOPLE) {
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error: signInError } = await client.auth.signInWithPassword({ email: email(who), password: PASSWORD });
      if (signInError) throw signInError;
      clients[who] = client;
    }
  });

  afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("lets a recipient report a message once, with a clear duplicate error", async () => {
    const first = await reportContent(clients.runner, {
      targetType: "message",
      targetId: abusiveId,
      reason: "harassment",
      details: "Threatening",
    });
    expect(first.ok).toBe(true);
    const again = await reportContent(clients.runner, {
      targetType: "message",
      targetId: abusiveId,
      reason: "spam",
      details: null,
    });
    expect(again).toMatchObject({ ok: false, code: "conflict", message: "You have already reported this." });
  });

  it("shows moderators the queue and the content only through the report", async () => {
    const direct = await clients.moderator.from("messages").select("id").eq("id", abusiveId);
    expect(direct.data).toEqual([]);
    const queue = await listReportQueue(clients.moderator);
    expect(queue.ok).toBe(true);
    const report = queue.ok ? queue.data.open.find((r) => r.targetId === abusiveId) : undefined;
    expect(report?.details).toBe("Threatening");
    const content = await viewReportedContent(clients.moderator, report!.id);
    expect(content).toMatchObject({ ok: true, data: { body: `abusive ${stamp}`, hidden: false } });

    const runnerView = await viewReportedContent(clients.runner, report!.id);
    expect(runnerView).toMatchObject({ ok: false, code: "forbidden" });

    const decided = await resolveReport(clients.moderator, {
      reportId: report!.id,
      decision: "hide_content",
      note: "Threats",
    });
    expect(decided.ok).toBe(true);

    const listed = await listMessages(clients.runner, ids.runner);
    const hidden = listed.ok ? listed.data.find((m) => m.id === abusiveId) : undefined;
    expect(hidden).toMatchObject({ hidden: true, body: null });
  });

  it("records the moderation trail for admins only, without message text", async () => {
    const forModerator = await clients.moderator.from("audit_log").select("id").limit(1);
    expect(forModerator.data).toEqual([]);
    const log = await listAuditLog(clients.admin);
    expect(log.ok).toBe(true);
    const entries = log.ok
      ? log.data.entries.filter((e) => e.targetId === abusiveId || JSON.stringify(e.metadata).includes(abusiveId))
      : [];
    expect(entries.map((e) => e.action).sort()).toEqual(
      ["message.hidden", "report.content_viewed", "report.resolved", "report.submitted"].sort(),
    );
    expect(JSON.stringify(entries)).not.toContain(`abusive ${stamp}`);
    expect(JSON.stringify(entries)).not.toContain("Threatening");

    const tamper = await clients.admin.from("audit_log").delete().gte("id", 0);
    expect(tamper.error?.code).toBe("42501");
  });

  it("holds the per-user report limit under a concurrent burst", async () => {
    // One report already filed above; nine more are allowed this hour.
    const results = await Promise.all(
      burstIds.map((targetId) =>
        reportContent(clients.runner, { targetType: "message", targetId, reason: "spam", details: null }),
      ),
    );
    const accepted = results.filter((r) => r.ok).length;
    const limited = results.filter((r) => !r.ok && r.code === "rate_limited");
    expect(accepted).toBe(9);
    expect(limited).toHaveLength(burstIds.length - 9);
    expect(limited[0]).toMatchObject({ message: expect.stringMatching(/wait a while/) });
  });
});
