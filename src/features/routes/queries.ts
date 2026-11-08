import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { ReportKind, RouteFilters } from "./logic";

export type RouteRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  area: string | null;
  locationId: string | null;
  distanceM: number;
  isLoop: boolean;
  elevationGainM: number | null;
  elevationLossM: number | null;
  elevationProfile: [number, number][] | null;
  surface: string;
  terrain: string;
  difficulty: string;
  beginnerSuitable: boolean | null;
  lighting: string;
  shade: string;
  waterRefill: boolean | null;
  toilets: boolean | null;
  parking: string | null;
  meetingPoint: string | null;
  trafficNotes: string | null;
  source: "osm" | "gpx";
  sourceRef: string;
  sourceAttribution: string;
  verified: boolean;
  verifiedAt: string | null;
  status: "draft" | "published" | "archived";
  createdBy: string | null;
  geojson: { type: "LineString"; coordinates: [number, number][] } | null;
};

const COLUMNS =
  "id, slug, name, description, area, location_id, distance_m, is_loop, elevation_gain_m, elevation_loss_m, elevation_profile, surface, terrain, difficulty, beginner_suitable, lighting, shade, water_refill, toilets, parking, meeting_point, traffic_notes, source, source_ref, source_attribution, verified, verified_at, status, created_by, route_geojson";

function toRoute(r: Record<string, unknown>): RouteRow {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    description: r.description as string,
    area: (r.area as string | null) ?? null,
    locationId: (r.location_id as string | null) ?? null,
    distanceM: Number(r.distance_m),
    isLoop: r.is_loop as boolean,
    elevationGainM: r.elevation_gain_m === null ? null : Number(r.elevation_gain_m),
    elevationLossM: r.elevation_loss_m === null ? null : Number(r.elevation_loss_m),
    elevationProfile: (r.elevation_profile as [number, number][] | null) ?? null,
    surface: r.surface as string,
    terrain: r.terrain as string,
    difficulty: r.difficulty as string,
    beginnerSuitable: (r.beginner_suitable as boolean | null) ?? null,
    lighting: r.lighting as string,
    shade: r.shade as string,
    waterRefill: (r.water_refill as boolean | null) ?? null,
    toilets: (r.toilets as boolean | null) ?? null,
    parking: (r.parking as string | null) ?? null,
    meetingPoint: (r.meeting_point as string | null) ?? null,
    trafficNotes: (r.traffic_notes as string | null) ?? null,
    source: r.source as "osm" | "gpx",
    sourceRef: r.source_ref as string,
    sourceAttribution: r.source_attribution as string,
    verified: r.verified as boolean,
    verifiedAt: (r.verified_at as string | null) ?? null,
    status: r.status as RouteRow["status"],
    createdBy: (r.created_by as string | null) ?? null,
    geojson: (r.route_geojson as RouteRow["geojson"]) ?? null,
  };
}

export type ReviewSummary = {
  reviews: number;
  rating: number | null;
  safety: number | null;
  shade: number | null;
  surface: number | null;
  crowd: number | null;
};

export async function reviewSummaries(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ReviewSummary>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc("route_review_summary", { p_route_ids: ids });
  if (error) throw new DatabaseQueryError("route_review_summary", error);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    map.set(r.route_id as string, {
      reviews: Number(r.reviews),
      rating: n(r.rating),
      safety: n(r.safety),
      shade: n(r.shade),
      surface: n(r.surface),
      crowd: n(r.crowd),
    });
  }
  return map;
}

/** Published routes matching the filters, plus the viewer's own drafts when asked. */
export async function listRoutes(
  supabase: SupabaseClient,
  filters: RouteFilters,
  opts: { includeDrafts?: boolean } = {},
) {
  let query = supabase.from("routes").select(COLUMNS).order("name").limit(200);
  query = opts.includeDrafts ? query.neq("status", "archived") : query.eq("status", "published");
  if (filters.beginner) query = query.eq("beginner_suitable", true);
  if (filters.loop) query = query.eq("is_loop", true);
  if (filters.verified) query = query.eq("verified", true);
  if (filters.minKm) query = query.gte("distance_m", filters.minKm * 1000);
  if (filters.maxKm) query = query.lte("distance_m", filters.maxKm * 1000);
  const { data, error } = await query;
  if (error) throw new DatabaseQueryError("routes", error);
  return (data ?? []).map(toRoute);
}

export type ConditionReport = { id: string; kind: ReportKind; note: string; createdAt: string; expiresAt: string };

export async function getRoute(supabase: SupabaseClient, slug: string, userId: string) {
  const { data, error } = await supabase.from("routes").select(COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new DatabaseQueryError("routes", error);
  if (!data) return null;
  const route = toRoute(data);
  const nowIso = new Date().toISOString();
  const [summary, comments, reports, mine, events] = await Promise.all([
    reviewSummaries(supabase, [route.id]),
    route.status === "published"
      ? supabase.rpc("route_review_comments", { p_route_id: route.id })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("route_reports")
      .select("id, kind, note, created_at, expires_at")
      .eq("route_id", route.id)
      .is("resolved_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("route_reviews")
      .select("rating, safety, shade, surface, crowd, comment")
      .eq("route_id", route.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("events")
      .select("id, title, starts_at")
      .eq("route_id", route.id)
      .eq("status", "published")
      .gte("ends_at", nowIso)
      .order("starts_at")
      .limit(5),
  ]);
  for (const [name, r] of [
    ["route_review_comments", comments],
    ["route_reports", reports],
    ["route_reviews", mine],
    ["events", events],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }
  return {
    now: Date.now(),
    route,
    summary: summary.get(route.id) ?? null,
    comments: ((comments.data ?? []) as { rating: number; comment: string; created_at: string }[]).map((c) => ({
      rating: c.rating,
      comment: c.comment,
      createdAt: new Date(c.created_at).toISOString(),
    })),
    reports: (
      (reports.data ?? []) as { id: string; kind: ReportKind; note: string; created_at: string; expires_at: string }[]
    ).map((r): ConditionReport => ({
      id: r.id,
      kind: r.kind,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    })),
    myReview: mine.data as {
      rating: number;
      safety: number | null;
      shade: number | null;
      surface: number | null;
      crowd: number | null;
      comment: string | null;
    } | null,
    events: ((events.data ?? []) as { id: string; title: string; starts_at: string }[]).map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: new Date(e.starts_at).toISOString(),
    })),
  };
}

/** Published routes for pickers (event and series forms). */
export async function routeOptions(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("routes")
    .select("id, name, distance_m")
    .eq("status", "published")
    .order("name")
    .limit(500);
  if (error) throw new DatabaseQueryError("routes", error);
  return ((data ?? []) as { id: string; name: string; distance_m: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    distanceM: Number(r.distance_m),
  }));
}
