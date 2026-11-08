import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { ClubRole, JoinPolicy } from "./logic";

export const CLUB_PAGE_SIZE = 20;

export type Club = {
  id: string;
  slug: string;
  name: string;
  description: string;
  area: string | null;
  homeLocationId: string | null;
  joinPolicy: JoinPolicy;
  status: "active" | "archived";
};

const CLUB_COLUMNS = "id, slug, name, description, area, home_location_id, join_policy, status";

function toClub(r: Record<string, unknown>): Club {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    description: r.description as string,
    area: (r.area as string | null) ?? null,
    homeLocationId: (r.home_location_id as string | null) ?? null,
    joinPolicy: r.join_policy as JoinPolicy,
    status: r.status as Club["status"],
  };
}

export type ClubStats = { members: number; upcomingEvents: number; attendedLast30Days: number };

export async function statsFor(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ClubStats>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc("club_stats", { p_club_ids: ids });
  if (error) throw new DatabaseQueryError("club_stats", error);
  for (const r of (data ?? []) as Record<string, number | string>[]) {
    map.set(r.club_id as string, {
      members: Number(r.members),
      upcomingEvents: Number(r.upcoming_events),
      attendedLast30Days: Number(r.attended_last_30_days),
    });
  }
  return map;
}

/** Active clubs by name, optionally filtered, cursor-paged by name. */
export async function listClubs(supabase: SupabaseClient, opts: { q?: string; after?: string | null }) {
  let query = supabase
    .from("clubs")
    .select(CLUB_COLUMNS)
    .eq("status", "active")
    .order("name")
    .order("id")
    .limit(CLUB_PAGE_SIZE + 1);
  const q = (opts.q ?? "").trim().slice(0, 60);
  if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (opts.after) query = query.gt("name", opts.after);
  const { data, error } = await query;
  if (error) throw new DatabaseQueryError("clubs", error);
  const rows = (data ?? []).map(toClub);
  const page = rows.slice(0, CLUB_PAGE_SIZE);
  return { clubs: page, nextAfter: rows.length > CLUB_PAGE_SIZE ? page[page.length - 1].name : null, q };
}

export type Membership = { role: ClubRole; status: "pending" | "active" } | null;

export async function myMemberships(supabase: SupabaseClient, userId: string, clubIds: string[]) {
  const map = new Map<string, NonNullable<Membership>>();
  if (clubIds.length === 0) return map;
  const { data, error } = await supabase
    .from("club_members")
    .select("club_id, role, status")
    .eq("user_id", userId)
    .in("club_id", clubIds);
  if (error) throw new DatabaseQueryError("club_members", error);
  for (const r of data ?? [])
    map.set(r.club_id as string, { role: r.role as ClubRole, status: r.status as "pending" | "active" });
  return map;
}

export type RosterMember = {
  userId: string;
  displayName: string;
  role: ClubRole;
  status: "pending" | "active";
  requestedAt: string;
};

/** Everything the club page needs. Null when the club is not visible. */
export async function getClubPage(
  supabase: SupabaseClient,
  slug: string,
  userId: string,
  roles: string[],
  week: { start: string; timezone: string },
) {
  const { data: row, error } = await supabase.from("clubs").select(CLUB_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new DatabaseQueryError("clubs", error);
  if (!row) return null;
  const club = toClub(row);
  const [memberships, stats, events, home] = await Promise.all([
    myMemberships(supabase, userId, [club.id]),
    statsFor(supabase, [club.id]),
    supabase
      .from("events")
      .select("id, title, starts_at, category")
      .eq("club_id", club.id)
      .eq("status", "published")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(10),
    club.homeLocationId
      ? supabase.from("locations").select("id, name").eq("id", club.homeLocationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (events.error) throw new DatabaseQueryError("events", events.error);
  const membership = memberships.get(club.id) ?? null;
  const member = membership?.status === "active";
  const isManager = roles.includes("programme_manager") || roles.includes("admin");
  const canAdmin = isManager || (member && membership?.role === "admin");
  const canLead = canAdmin || (member && membership?.role === "captain");

  const [announcements, leaderboard, roster] = await Promise.all([
    member || canAdmin
      ? supabase
          .from("club_announcements")
          .select("id, title, body, created_at")
          .eq("club_id", club.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    member
      ? supabase.rpc("club_leaderboard", {
          p_club_id: club.id,
          p_week_start: week.start,
          p_timezone: week.timezone,
          p_limit: 10,
        })
      : Promise.resolve({ data: [], error: null }),
    member || canLead
      ? supabase.rpc("club_roster", { p_club_id: club.id })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const [name, r] of [
    ["club_announcements", announcements],
    ["club_leaderboard", leaderboard],
    ["club_roster", roster],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }

  return {
    now: Date.now(),
    club,
    membership,
    member,
    canAdmin,
    canLead,
    stats: stats.get(club.id) ?? { members: 0, upcomingEvents: 0, attendedLast30Days: 0 },
    events: ((events.data ?? []) as { id: string; title: string; starts_at: string; category: string }[]).map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: new Date(e.starts_at).toISOString(),
      category: e.category,
    })),
    home: home.data as { id: string; name: string } | null,
    announcements: (
      (announcements.data ?? []) as { id: string; title: string; body: string; created_at: string }[]
    ).map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: new Date(a.created_at).toISOString() })),
    leaderboard: ((leaderboard.data ?? []) as Record<string, unknown>[]).map((r) => ({
      rank: Number(r.rank),
      displayName: r.display_name as string,
      xp: Number(r.xp),
      workouts: Number(r.workouts),
      isMe: r.is_me as boolean,
    })),
    roster: ((roster.data ?? []) as Record<string, unknown>[]).map((r): RosterMember => ({
      userId: r.user_id as string,
      displayName: r.display_name as string,
      role: r.role as ClubRole,
      status: r.status as "pending" | "active",
      requestedAt: new Date(r.requested_at as string).toISOString(),
    })),
  };
}

export async function listInvites(supabase: SupabaseClient, clubId: string) {
  const { data, error } = await supabase
    .from("club_invites")
    .select("id, code, expires_at, max_uses, uses, revoked_at")
    .eq("club_id", clubId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new DatabaseQueryError("club_invites", error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    expiresAt: new Date(r.expires_at as string).toISOString(),
    maxUses: r.max_uses as number,
    uses: r.uses as number,
  }));
}
