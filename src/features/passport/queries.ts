import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { ChecklistItem, RaceDistance, ResultSource } from "./logic";

export type RaceEntry = {
  id: string;
  eventId: string | null;
  name: string;
  raceDate: string;
  distance: RaceDistance;
  distanceM: number;
  city: string | null;
  status: "planned" | "registered" | "completed" | "dnf" | "dns" | "cancelled";
  targetSeconds: number | null;
  bib: string | null;
  wave: string | null;
  checklist: ChecklistItem[];
  travelNotes: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  resultSeconds: number | null;
  resultSource: ResultSource | null;
  resultActivityId: string | null;
  reflection: string | null;
  findPartners: boolean;
};

export const toEntry = (r: Record<string, unknown>): RaceEntry => ({
  id: r.id as string,
  eventId: (r.event_id as string | null) ?? null,
  name: r.name as string,
  raceDate: r.race_date as string,
  distance: r.distance as RaceDistance,
  distanceM: Number(r.distance_m),
  city: (r.city as string | null) ?? null,
  status: r.status as RaceEntry["status"],
  targetSeconds: (r.target_seconds as number | null) ?? null,
  bib: (r.bib as string | null) ?? null,
  wave: (r.wave as string | null) ?? null,
  checklist: (r.checklist as ChecklistItem[]) ?? [],
  travelNotes: (r.travel_notes as string | null) ?? null,
  emergencyName: (r.emergency_name as string | null) ?? null,
  emergencyPhone: (r.emergency_phone as string | null) ?? null,
  resultSeconds: (r.result_seconds as number | null) ?? null,
  resultSource: (r.result_source as ResultSource | null) ?? null,
  resultActivityId: (r.result_activity_id as string | null) ?? null,
  reflection: (r.reflection as string | null) ?? null,
  findPartners: Boolean(r.find_partners),
});

export async function myRaces(supabase: SupabaseClient, userId: string) {
  const [entries, rsvps, results] = await Promise.all([
    supabase.from("race_entries").select("*").eq("user_id", userId).order("race_date", { ascending: false }).limit(100),
    supabase
      .from("event_rsvps")
      .select("event_id, status, events!inner(id, title, starts_at, status)")
      .eq("user_id", userId)
      .eq("status", "going")
      .limit(50),
    supabase
      .from("event_results")
      .select("event_id, outcome, finish_seconds, distance_meters, events!inner(title, starts_at)")
      .eq("user_id", userId)
      .limit(100),
  ]);
  if (entries.error) throw new DatabaseQueryError("race_entries", entries.error);
  const list = ((entries.data ?? []) as Record<string, unknown>[]).map(toEntry);
  const linked = new Set(list.map((e) => e.eventId).filter(Boolean));
  const upcomingEvents = ((rsvps.data ?? []) as Record<string, unknown>[])
    .map((r) => r.events as { id: string; title: string; starts_at: string; status: string })
    .filter(
      (e) =>
        e.status === "published" &&
        Date.parse(e.starts_at) > Date.parse(new Date().toISOString()) - 86_400_000 &&
        !linked.has(e.id),
    );
  const verified = new Map(
    ((results.data ?? []) as Record<string, unknown>[]).map((r) => [
      r.event_id as string,
      {
        outcome: r.outcome as string,
        finishSeconds: (r.finish_seconds as number | null) ?? null,
        title: (r.events as { title: string }).title,
        startsAt: (r.events as { starts_at: string }).starts_at,
      },
    ]),
  );
  return { entries: list, upcomingEvents, verified };
}

export async function raceHub(supabase: SupabaseClient, id: string, userId: string) {
  const { data, error } = await supabase
    .from("race_entries")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new DatabaseQueryError("race_entries", error);
  if (!data) return null;
  const entry = toEntry(data);
  let event = null as null | {
    id: string;
    title: string;
    startsAt: string;
    routeId: string | null;
    location: { name: string; latitude: number; longitude: number } | null;
    rsvp: { status: string; checkinToken: string; checkedInAt: string | null; paceGroup: string | null } | null;
    result: { outcome: string; finishSeconds: number | null } | null;
    sponsors: { name: string; url: string | null; tier: string }[];
  };
  if (entry.eventId) {
    const [ev, rsvp, result, sponsors] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, starts_at, route_id, locations(name, latitude, longitude)")
        .eq("id", entry.eventId)
        .maybeSingle(),
      supabase
        .from("event_rsvps")
        .select("status, checkin_token, checked_in_at, event_pace_groups(label)")
        .eq("event_id", entry.eventId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("event_results")
        .select("outcome, finish_seconds")
        .eq("event_id", entry.eventId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("event_sponsors").select("name, url, tier").eq("event_id", entry.eventId).order("tier"),
    ]);
    if (ev.data) {
      const r = rsvp.data as Record<string, unknown> | null;
      event = {
        id: ev.data.id,
        title: ev.data.title,
        startsAt: ev.data.starts_at,
        routeId: ev.data.route_id,
        location:
          (ev.data.locations as unknown as { name: string; latitude: number; longitude: number } | null) ?? null,
        rsvp: r
          ? {
              status: r.status as string,
              checkinToken: r.checkin_token as string,
              checkedInAt: (r.checked_in_at as string | null) ?? null,
              paceGroup: ((r.event_pace_groups as { label?: string } | null)?.label as string | undefined) ?? null,
            }
          : null,
        result: result.data
          ? {
              outcome: result.data.outcome as string,
              finishSeconds: (result.data.finish_seconds as number | null) ?? null,
            }
          : null,
        sponsors: (sponsors.data ?? []) as { name: string; url: string | null; tier: string }[],
      };
    }
  }
  const partners = entry.findPartners
    ? (((await supabase.rpc("race_partners", { p_entry: id })).data ?? []) as {
        user_id: string;
        display_name: string;
        target_seconds: number | null;
        fitness_level: string | null;
      }[])
    : [];
  const activities = (
    await supabase
      .from("activities")
      .select("id, name, started_at, distance_m, elapsed_seconds")
      .eq("user_id", userId)
      .eq("status", "ready")
      .gte("started_at", `${entry.raceDate}T00:00:00+05:30`)
      .lt("started_at", `${entry.raceDate}T23:59:59+05:30`)
      .limit(5)
  ).data as
    { id: string; name: string | null; started_at: string; distance_m: number; elapsed_seconds: number }[] | null;
  return { entry, event, partners, raceDayActivities: activities ?? [] };
}
