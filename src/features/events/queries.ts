import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { EventCategory, EventFilters, RsvpStatus, TeamRole } from "./logic";

export const EVENT_PAGE_SIZE = 20;

const EVENT_COLUMNS =
  "id, title, description, starts_at, ends_at, location_id, capacity, status, created_by, category, meeting_point, registration_closes_at, route_id";

export type EventRow = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  locationId: string | null;
  capacity: number | null;
  status: "draft" | "published" | "cancelled";
  createdBy: string | null;
  category: EventCategory;
  meetingPoint: string | null;
  registrationClosesAt: string | null;
  routeId: string | null;
};

function toEvent(r: Record<string, unknown>): EventRow {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    startsAt: new Date(r.starts_at as string).toISOString(),
    endsAt: new Date(r.ends_at as string).toISOString(),
    locationId: (r.location_id as string | null) ?? null,
    capacity: (r.capacity as number | null) ?? null,
    status: r.status as EventRow["status"],
    createdBy: (r.created_by as string | null) ?? null,
    category: r.category as EventCategory,
    meetingPoint: (r.meeting_point as string | null) ?? null,
    registrationClosesAt: r.registration_closes_at ? new Date(r.registration_closes_at as string).toISOString() : null,
    routeId: (r.route_id as string | null) ?? null,
  };
}

/**
 * Published events, cursor-paged by start time: upcoming soonest first, past
 * most recent first. Returns the next cursor when there are more.
 */
export async function listEvents(supabase: SupabaseClient, filters: EventFilters) {
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("status", "published")
    .limit(EVENT_PAGE_SIZE + 1);
  if (filters.when === "past") {
    query = query.lt("ends_at", nowIso).order("starts_at", { ascending: false }).order("id", { ascending: false });
    if (filters.cursor) query = query.lt("starts_at", filters.cursor);
  } else {
    query = query.gte("ends_at", nowIso).order("starts_at", { ascending: true }).order("id", { ascending: true });
    if (filters.cursor) query = query.gt("starts_at", filters.cursor);
  }
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  const { data, error } = await query;
  if (error) throw new DatabaseQueryError("events", error);
  const rows = (data ?? []).map(toEvent);
  const page = rows.slice(0, EVENT_PAGE_SIZE);
  return {
    events: page,
    nextCursor: rows.length > EVENT_PAGE_SIZE ? page[page.length - 1].startsAt : null,
    // The reference time the page renders against (registration, countdowns).
    now: Date.now(),
  };
}

export async function attendanceFor(supabase: SupabaseClient, eventIds: string[]) {
  const map = new Map<string, { going: number; waitlisted: number }>();
  if (eventIds.length === 0) return map;
  const { data, error } = await supabase.rpc("event_attendance", { p_event_ids: eventIds });
  if (error) throw new DatabaseQueryError("event_attendance", error);
  for (const r of (data ?? []) as { event_id: string; going: number; waitlisted: number | null }[]) {
    map.set(r.event_id, { going: Number(r.going), waitlisted: Number(r.waitlisted ?? 0) });
  }
  return map;
}

export type MyRsvp = {
  status: RsvpStatus;
  paceGroupId: string | null;
  checkedIn: boolean;
};

/** The caller's RSVPs for the given events (RLS: own rows; team rows filtered by user id). */
export async function myRsvpsFor(supabase: SupabaseClient, userId: string, eventIds: string[]) {
  const map = new Map<string, MyRsvp>();
  if (eventIds.length === 0) return map;
  const { data, error } = await supabase
    .from("event_rsvps")
    .select("event_id, status, pace_group_id, checked_in_at")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (error) throw new DatabaseQueryError("event_rsvps", error);
  for (const r of data ?? []) {
    map.set(r.event_id as string, {
      status: r.status as RsvpStatus,
      paceGroupId: (r.pace_group_id as string | null) ?? null,
      checkedIn: Boolean(r.checked_in_at),
    });
  }
  return map;
}

export type PaceGroup = {
  id: string;
  label: string;
  minPace: number | null;
  maxPace: number | null;
  runWalk: boolean;
  notes: string | null;
};

/** Everything the event page shows. Null when the event is not visible to the caller. */
export async function getEventDetail(supabase: SupabaseClient, eventId: string, userId: string, roles: string[]) {
  const { data: row, error } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) throw new DatabaseQueryError("events", error);
  if (!row) return null;
  const event = toEvent(row);

  const [location, attendance, rsvps, position, paceGroups, updates, team, myTeam, result, route] = await Promise.all([
    event.locationId
      ? supabase
          .from("locations")
          .select("id, name, address, latitude, longitude")
          .eq("id", event.locationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    attendanceFor(supabase, [event.id]),
    myRsvpsFor(supabase, userId, [event.id]),
    supabase.rpc("my_waitlist_position", { p_event_id: event.id }),
    supabase
      .from("event_pace_groups")
      .select("id, label, min_pace_seconds, max_pace_seconds, run_walk, notes")
      .eq("event_id", event.id)
      .order("sort_order")
      .order("min_pace_seconds", { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from("event_updates")
      .select("id, body, created_at")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.rpc("event_team_members", { p_event_id: event.id }),
    supabase.from("event_team").select("role").eq("event_id", event.id).eq("user_id", userId).maybeSingle(),
    supabase
      .from("event_results")
      .select("outcome, finish_seconds")
      .eq("event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle(),
    event.routeId
      ? supabase
          .from("routes")
          .select("slug, name, distance_m, is_loop, route_geojson")
          .eq("id", event.routeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const [name, r] of [
    ["locations", location],
    ["my_waitlist_position", position],
    ["event_pace_groups", paceGroups],
    ["event_updates", updates],
    ["event_team_members", team],
    ["event_team", myTeam],
    ["event_results", result],
    ["routes", route],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }

  const teamRole = ((myTeam.data as { role: TeamRole } | null)?.role ?? null) as TeamRole | null;
  const isManager = roles.includes("programme_manager") || roles.includes("admin");
  return {
    now: Date.now(),
    event,
    location: location.data as { id: string; name: string; address: string | null } | null,
    counts: attendance.get(event.id) ?? { going: 0, waitlisted: 0 },
    mine: rsvps.get(event.id) ?? null,
    waitlistPosition: (position.data as number | null) ?? null,
    paceGroups: ((paceGroups.data ?? []) as Record<string, unknown>[]).map((g): PaceGroup => ({
      id: g.id as string,
      label: g.label as string,
      minPace: (g.min_pace_seconds as number | null) ?? null,
      maxPace: (g.max_pace_seconds as number | null) ?? null,
      runWalk: g.run_walk as boolean,
      notes: (g.notes as string | null) ?? null,
    })),
    updates: ((updates.data ?? []) as { id: string; body: string; created_at: string }[]).map((u) => ({
      id: u.id,
      body: u.body,
      createdAt: new Date(u.created_at).toISOString(),
    })),
    team: (team.data ?? []) as { display_name: string; role: TeamRole; user_id: string | null }[],
    route: route.data as {
      slug: string;
      name: string;
      distance_m: number;
      is_loop: boolean;
      route_geojson: { type: "LineString"; coordinates: [number, number][] } | null;
    } | null,
    result: result.data as { outcome: "finished" | "dnf" | "dns"; finish_seconds: number | null } | null,
    teamRole,
    canManage: isManager || teamRole === "organiser",
    canStaff: isManager || teamRole !== null,
  };
}

export type RosterEntry = {
  userId: string;
  displayName: string;
  status: "going" | "waitlisted";
  paceGroupId: string | null;
  checkedIn: boolean;
  teamRole: TeamRole | null;
  result: { outcome: "finished" | "dnf" | "dns"; finishSeconds: number | null } | null;
};

/** Roster with check-in state and results, for the event team. */
export async function getRoster(supabase: SupabaseClient, eventId: string): Promise<RosterEntry[]> {
  const [roster, results] = await Promise.all([
    supabase.rpc("event_roster", { p_event_id: eventId }),
    supabase.from("event_results").select("user_id, outcome, finish_seconds").eq("event_id", eventId).limit(1000),
  ]);
  if (roster.error) throw new DatabaseQueryError("event_roster", roster.error);
  if (results.error) throw new DatabaseQueryError("event_results", results.error);
  const byUser = new Map(
    (
      (results.data ?? []) as { user_id: string; outcome: "finished" | "dnf" | "dns"; finish_seconds: number | null }[]
    ).map((r) => [r.user_id, { outcome: r.outcome, finishSeconds: r.finish_seconds }]),
  );
  return ((roster.data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    displayName: r.display_name as string,
    status: r.status as "going" | "waitlisted",
    paceGroupId: (r.pace_group_id as string | null) ?? null,
    checkedIn: Boolean(r.checked_in_at),
    teamRole: (r.team_role as TeamRole | null) ?? null,
    result: byUser.get(r.user_id as string) ?? null,
  }));
}
