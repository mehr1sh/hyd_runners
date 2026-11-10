import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export type LiveState = {
  event: { id: string; title: string; startsAt: string; endsAt: string; routeId: string | null };
  isStaff: boolean;
  isParticipant: boolean;
  session: { id: string; endsAt: string; endedAt: string | null } | null;
  myShare: { expiresAt: string; stoppedAt: string | null } | null;
  shares: { userId: string; name: string; expiresAt: string; stoppedAt: string | null }[];
  positions: { userId: string; name: string; lat: number; lon: number; accuracy: number | null; recordedAt: string }[];
  help: {
    id: string;
    userId: string;
    name: string;
    note: string | null;
    lat: number | null;
    lon: number | null;
    createdAt: string;
    resolvedAt: string | null;
  }[];
};

export async function liveState(supabase: SupabaseClient, eventId: string, userId: string): Promise<LiveState | null> {
  const [ev, staff, rsvp, session] = await Promise.all([
    supabase.from("events").select("id, title, starts_at, ends_at, route_id").eq("id", eventId).maybeSingle(),
    supabase.rpc("can_staff_live", { p_event: eventId }),
    supabase.from("event_rsvps").select("status").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    supabase.from("live_sessions").select("id, ends_at, ended_at").eq("event_id", eventId).maybeSingle(),
  ]);
  if (ev.error) throw new DatabaseQueryError("events", ev.error);
  if (!ev.data) return null;
  const s = session.data as { id: string; ends_at: string; ended_at: string | null } | null;
  let shares: LiveState["shares"] = [];
  let positions: LiveState["positions"] = [];
  let help: LiveState["help"] = [];
  if (s) {
    await supabase.rpc("purge_stale_live_positions");
    // Profiles aren't readable across runners; staff get names from the event roster and team.
    const [sh, pos, hr, roster, team] = await Promise.all([
      supabase.from("live_shares").select("user_id, expires_at, stopped_at").eq("session_id", s.id),
      supabase.from("live_positions").select("user_id, lat, lon, accuracy_m, recorded_at").eq("session_id", s.id),
      supabase
        .from("live_help_requests")
        .select("id, user_id, note, lat, lon, created_at, resolved_at")
        .eq("session_id", s.id)
        .order("created_at", { ascending: false }),
      staff.data ? supabase.rpc("event_roster", { p_event_id: eventId }) : Promise.resolve({ data: [] }),
      staff.data ? supabase.rpc("event_team_members", { p_event_id: eventId }) : Promise.resolve({ data: [] }),
    ]);
    const names = new Map<string, string>();
    for (const r of [
      ...((roster.data ?? []) as Record<string, unknown>[]),
      ...((team.data ?? []) as Record<string, unknown>[]),
    ])
      if (r.user_id && r.display_name) names.set(r.user_id as string, r.display_name as string);
    const nameOf = (r: Record<string, unknown>) =>
      r.user_id === userId ? "You" : (names.get(r.user_id as string) ?? "A runner");
    shares = ((sh.data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: r.user_id as string,
      name: nameOf(r),
      expiresAt: r.expires_at as string,
      stoppedAt: (r.stopped_at as string | null) ?? null,
    }));
    positions = ((pos.data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: r.user_id as string,
      name: nameOf(r),
      lat: Number(r.lat),
      lon: Number(r.lon),
      accuracy: r.accuracy_m === null ? null : Number(r.accuracy_m),
      recordedAt: r.recorded_at as string,
    }));
    help = ((hr.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      name: nameOf(r),
      note: (r.note as string | null) ?? null,
      lat: r.lat === null ? null : Number(r.lat),
      lon: r.lon === null ? null : Number(r.lon),
      createdAt: r.created_at as string,
      resolvedAt: (r.resolved_at as string | null) ?? null,
    }));
  }
  const mine = shares.find((x) => x.userId === userId);
  return {
    event: {
      id: ev.data.id,
      title: ev.data.title,
      startsAt: ev.data.starts_at,
      endsAt: ev.data.ends_at,
      routeId: ev.data.route_id,
    },
    isStaff: Boolean(staff.data),
    isParticipant: (rsvp.data?.status as string | undefined) === "going",
    session: s ? { id: s.id, endsAt: s.ends_at, endedAt: s.ended_at } : null,
    myShare: mine ? { expiresAt: mine.expiresAt, stoppedAt: mine.stoppedAt } : null,
    shares,
    positions,
    help,
  };
}

export async function groupRunRecap(supabase: SupabaseClient, eventId: string) {
  const { data, error } = await supabase.rpc("group_run_recap", { p_event: eventId });
  if (error) return null;
  return data as {
    going: number;
    checkedIn: number;
    finished: number;
    paceGroups: { label: string; checkedIn: number }[];
    activities: number | null;
    distanceM: number | null;
    routeId: string | null;
    ended: boolean;
  };
}

export type RadarRun = {
  id: string;
  title: string;
  startsAt: string;
  locationName: string;
  lat: number;
  lon: number;
  capacity: number | null;
  going: number;
  paceGroups: string[];
  clubId: string | null;
  beginner: boolean;
};

/** Upcoming published group runs with a meeting place, for Run Radar. No runner locations are involved. */
export async function radarRuns(supabase: SupabaseClient, days = 14): Promise<RadarRun[]> {
  const nowIso = new Date().toISOString();
  const until = new Date(Date.parse(nowIso) + days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, title, starts_at, capacity, club_id, locations!inner(name, latitude, longitude), event_pace_groups(label, sort_order), group_run_series(beginner_friendly)",
    )
    .eq("status", "published")
    .gte("starts_at", nowIso)
    .lt("starts_at", until)
    .order("starts_at")
    .limit(60);
  if (error) throw new DatabaseQueryError("events", error);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);
  const att = ids.length ? await supabase.rpc("event_attendance", { p_event_ids: ids }) : { data: [] };
  const going = new Map(
    ((att.data ?? []) as { event_id: string; going: number }[]).map((a) => [a.event_id, Number(a.going)]),
  );
  return rows.map((r) => {
    const loc = r.locations as { name: string; latitude: number; longitude: number };
    return {
      id: r.id as string,
      title: r.title as string,
      startsAt: r.starts_at as string,
      locationName: loc.name,
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      capacity: (r.capacity as number | null) ?? null,
      going: going.get(r.id as string) ?? 0,
      paceGroups: ((r.event_pace_groups as { label: string; sort_order: number }[] | null) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => g.label),
      clubId: (r.club_id as string | null) ?? null,
      beginner: Boolean((r.group_run_series as { beginner_friendly?: boolean } | null)?.beginner_friendly),
    };
  });
}
