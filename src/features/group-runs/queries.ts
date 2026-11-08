import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export type Series = {
  id: string;
  clubId: string | null;
  title: string;
  description: string;
  locationId: string | null;
  meetingPoint: string | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  timezone: string;
  capacity: number | null;
  beginnerFriendly: boolean;
  noDrop: boolean;
  regroupPolicy: string;
  paceGroups: { label: string; min_pace_seconds: number | null; max_pace_seconds: number | null; run_walk: boolean }[];
  active: boolean;
};

const COLUMNS =
  "id, club_id, title, description, location_id, meeting_point, weekday, start_time, duration_minutes, timezone, capacity, beginner_friendly, no_drop, regroup_policy, pace_groups, active";

function toSeries(r: Record<string, unknown>): Series {
  return {
    id: r.id as string,
    clubId: (r.club_id as string | null) ?? null,
    title: r.title as string,
    description: r.description as string,
    locationId: (r.location_id as string | null) ?? null,
    meetingPoint: (r.meeting_point as string | null) ?? null,
    weekday: r.weekday as number,
    startTime: r.start_time as string,
    durationMinutes: r.duration_minutes as number,
    timezone: r.timezone as string,
    capacity: (r.capacity as number | null) ?? null,
    beginnerFriendly: r.beginner_friendly as boolean,
    noDrop: r.no_drop as boolean,
    regroupPolicy: r.regroup_policy as string,
    paceGroups: (r.pace_groups as Series["paceGroups"]) ?? [],
    active: r.active as boolean,
  };
}

/** Active series (beginner-friendly first when asked), with each one's next run. */
export async function listSeries(supabase: SupabaseClient, opts: { beginner?: boolean; clubId?: string } = {}) {
  let query = supabase
    .from("group_run_series")
    .select(COLUMNS)
    .eq("active", true)
    .order("weekday")
    .order("start_time")
    .limit(100);
  if (opts.beginner) query = query.eq("beginner_friendly", true);
  if (opts.clubId) query = query.eq("club_id", opts.clubId);
  const { data, error } = await query;
  if (error) throw new DatabaseQueryError("group_run_series", error);
  const series = (data ?? []).map(toSeries);
  const next = new Map<string, { id: string; startsAt: string }>();
  if (series.length) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, series_id, starts_at")
      .in(
        "series_id",
        series.map((s) => s.id),
      )
      .eq("status", "published")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(500);
    if (eventsError) throw new DatabaseQueryError("events", eventsError);
    for (const e of events ?? []) {
      if (!next.has(e.series_id as string))
        next.set(e.series_id as string, {
          id: e.id as string,
          startsAt: new Date(e.starts_at as string).toISOString(),
        });
    }
  }
  return series.map((s) => ({ ...s, next: next.get(s.id) ?? null }));
}

export async function getSeries(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("group_run_series").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new DatabaseQueryError("group_run_series", error);
  if (!data) return null;
  const series = toSeries(data);
  const [upcoming, history, club, location] = await Promise.all([
    supabase
      .from("events")
      .select("id, starts_at, capacity")
      .eq("series_id", id)
      .eq("status", "published")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(8),
    supabase.rpc("series_history", { p_series_id: id, p_limit: 12 }),
    series.clubId
      ? supabase.from("clubs").select("slug, name").eq("id", series.clubId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    series.locationId
      ? supabase.from("locations").select("id, name").eq("id", series.locationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const [name, r] of [
    ["events", upcoming],
    ["series_history", history],
    ["clubs", club],
    ["locations", location],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }
  return {
    series,
    upcoming: ((upcoming.data ?? []) as { id: string; starts_at: string }[]).map((e) => ({
      id: e.id,
      startsAt: new Date(e.starts_at).toISOString(),
    })),
    history: ((history.data ?? []) as { event_id: string; starts_at: string; going: number; checked_in: number }[]).map(
      (h) => ({
        eventId: h.event_id,
        startsAt: new Date(h.starts_at).toISOString(),
        going: Number(h.going),
        checkedIn: Number(h.checked_in),
      }),
    ),
    club: club.data as { slug: string; name: string } | null,
    location: location.data as { id: string; name: string } | null,
  };
}

/** The caller's own attendance at past runs (RLS: own RSVPs). */
export async function myRunHistory(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("event_rsvps")
    .select("event_id, checked_in_at, events!inner(title, starts_at, ends_at, series_id)")
    .eq("user_id", userId)
    .not("checked_in_at", "is", null)
    .order("checked_in_at", { ascending: false })
    .limit(20);
  if (error) throw new DatabaseQueryError("event_rsvps", error);
  return ((data ?? []) as unknown as { event_id: string; events: { title: string; starts_at: string } }[]).map((r) => ({
    eventId: r.event_id,
    title: r.events.title,
    startsAt: new Date(r.events.starts_at).toISOString(),
  }));
}
