/**
 * Event capacity, waiting lists and promotion through the real Data API
 * against the LOCAL Supabase stack, with concurrent sign-ups.
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
const RUNNERS = 8;
const CAPACITY = 3;

describe.skipIf(!enabled)("event capacity and waiting lists (local Supabase)", async () => {
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
  let eventId = "";

  beforeAll(async () => {
    for (let i = 0; i < RUNNERS; i++) {
      const email = `itest-events-${i}-${stamp}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Events ${i} ${stamp}` },
      });
      if (error) throw error;
      ids.push(data.user.id);
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (signInError) throw signInError;
      clients.push(client);
    }
    const { data, error } = await admin
      .from("events")
      .insert({
        title: `Capacity test ${stamp}`,
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        ends_at: new Date(Date.now() + 90_000_000).toISOString(),
        capacity: CAPACITY,
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw error;
    eventId = data.id;
  });

  afterAll(async () => {
    if (eventId) await admin.from("events").delete().eq("id", eventId);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  const rsvp = (i: number, status: string) =>
    clients[i]
      .from("event_rsvps")
      .upsert({ event_id: eventId, user_id: ids[i], status }, { onConflict: "event_id,user_id" });
  const statuses = async () => {
    const { data } = await admin.from("event_rsvps").select("user_id, status").eq("event_id", eventId);
    return new Map((data ?? []).map((r) => [r.user_id as string, r.status as string]));
  };

  it("never overfills an event under concurrent sign-ups", async () => {
    const results = await Promise.all(ids.map((_, i) => rsvp(i, "going")));
    const accepted = results.filter((r) => !r.error).length;
    const full = results.filter((r) => r.error?.message.includes("full")).length;
    expect(accepted).toBe(CAPACITY);
    expect(full).toBe(RUNNERS - CAPACITY);
    const going = [...(await statuses()).values()].filter((s) => s === "going").length;
    expect(going).toBe(CAPACITY);
  });

  it("queues the rest on the waiting list and promotes them in order", async () => {
    const before = await statuses();
    const waiting = ids.map((id, i) => ({ id, i })).filter(({ id }) => !before.has(id));
    for (const { i } of waiting) {
      const { error } = await rsvp(i, "waitlisted");
      expect(error).toBeNull();
    }
    const { data: position } = await clients[waiting[0].i].rpc("my_waitlist_position", { p_event_id: eventId });
    expect(position).toBe(1);

    const holder = ids.findIndex((id) => before.get(id) === "going");
    expect((await rsvp(holder, "cancelled")).error).toBeNull();
    const after = await statuses();
    expect(after.get(waiting[0].id)).toBe("going");
    expect(after.get(waiting[1].id)).toBe("waitlisted");
    expect([...after.values()].filter((s) => s === "going").length).toBe(CAPACITY);
  });

  it("does not let runners read each other's RSVPs or check themselves in", async () => {
    const { data } = await clients[0].from("event_rsvps").select("user_id").eq("event_id", eventId);
    expect((data ?? []).every((r) => r.user_id === ids[0])).toBe(true);
    const selfCheckIn = await clients[0].rpc("check_in_attendee", {
      p_event_id: eventId,
      p_user_id: ids[0],
      p_present: true,
    });
    expect(selfCheckIn.error?.code).toBe("42501");
  });
});
