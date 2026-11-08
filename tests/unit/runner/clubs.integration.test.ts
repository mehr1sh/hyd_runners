/**
 * Club invites and membership through the real Data API against the LOCAL
 * Supabase stack, including concurrent redemptions of a limited invite.
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

describe.skipIf(!enabled)("club invites and membership (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const stamp = Date.now();
  const ids: string[] = [];
  const clients: SupabaseClient[] = [];
  let clubId = "";
  let code = "";

  beforeAll(async () => {
    for (let i = 0; i < 6; i++) {
      const email = `itest-clubs-${i}-${stamp}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Clubs ${i} ${stamp}` },
      });
      if (error) throw error;
      ids.push(data.user.id);
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (e2) throw e2;
      clients.push(client);
    }
    const { data: club, error } = await admin
      .from("clubs")
      .insert({ slug: `itest-club-${stamp}`, name: `Invite club ${stamp}`, join_policy: "invite" })
      .select("id")
      .single();
    if (error) throw error;
    clubId = club.id;
    // Runner 0 is the club admin.
    const { error: memberError } = await admin.from("club_members").insert({
      club_id: clubId,
      user_id: ids[0],
      role: "admin",
      status: "active",
      joined_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;
    const { data: invite, error: inviteError } = await clients[0]
      .from("club_invites")
      .insert({ club_id: clubId, created_by: ids[0], max_uses: 3 })
      .select("code")
      .single();
    if (inviteError) throw inviteError;
    code = invite.code;
  });

  afterAll(async () => {
    if (clubId) await admin.from("clubs").delete().eq("id", clubId);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  it("admits exactly as many people as the invite allows, even concurrently", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => clients[i].rpc("join_club_with_invite", { p_code: code })),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(3);
    expect(results.filter((r) => r.error?.code === "P0002")).toHaveLength(2);
    const { count } = await admin
      .from("club_members")
      .select("user_id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("status", "active");
    expect(count).toBe(4);
  });

  it("keeps invite codes and the roster away from non-members", async () => {
    const outsider = clients.findIndex((_, i) => i > 0);
    const members = await admin.from("club_members").select("user_id").eq("club_id", clubId);
    const memberIds = new Set((members.data ?? []).map((m) => m.user_id));
    const nonMember = clients[[1, 2, 3, 4, 5].find((i) => !memberIds.has(ids[i])) ?? outsider];
    const codes = await nonMember.from("club_invites").select("code").eq("club_id", clubId);
    expect(codes.data).toEqual([]);
    const roster = await nonMember.rpc("club_roster", { p_club_id: clubId });
    expect(roster.error?.code).toBe("42501");
  });
});
