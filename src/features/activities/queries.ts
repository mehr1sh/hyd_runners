import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { PrKey, Split } from "./logic/normalize";

export const ACTIVITY_PAGE_SIZE = 20;

const COLUMNS =
  "id, user_id, activity_type, name, visibility, privacy_trim_m, status, failure_reason, source_format, started_at, ended_at, elapsed_seconds, moving_seconds, moving_source, distance_m, avg_pace_s, elevation_gain_m, elevation_loss_m, elevation_profile, km_splits, mile_splits, best_efforts, has_gps, workout_log_id, created_at, activity_public_geojson";

export type Activity = {
  id: string;
  userId: string;
  type: "run" | "walk_run" | "walk" | "hike";
  name: string | null;
  visibility: "private" | "followers" | "public";
  privacyTrimM: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  failureReason: string | null;
  format: "gpx" | "fit" | null;
  startedAt: string | null;
  endedAt: string | null;
  elapsedSeconds: number | null;
  movingSeconds: number | null;
  movingSource: "device" | "derived" | null;
  distanceM: number | null;
  avgPace: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  elevationProfile: [number, number][] | null;
  kmSplits: Split[] | null;
  mileSplits: Split[] | null;
  bestEfforts: Partial<Record<PrKey, number>>;
  hasGps: boolean | null;
  workoutLogId: string | null;
  createdAt: string;
  publicPath: [number, number][] | null;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function toActivity(r: Record<string, unknown>): Activity {
  const geo = r.activity_public_geojson as { coordinates: [number, number][] } | null;
  return {
    id: r.id as string,
    userId: r.user_id as string,
    type: r.activity_type as Activity["type"],
    name: (r.name as string | null) ?? null,
    visibility: r.visibility as Activity["visibility"],
    privacyTrimM: r.privacy_trim_m as number,
    status: r.status as Activity["status"],
    failureReason: (r.failure_reason as string | null) ?? null,
    format: (r.source_format as Activity["format"]) ?? null,
    startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at as string).toISOString() : null,
    elapsedSeconds: num(r.elapsed_seconds),
    movingSeconds: num(r.moving_seconds),
    movingSource: (r.moving_source as Activity["movingSource"]) ?? null,
    distanceM: num(r.distance_m),
    avgPace: num(r.avg_pace_s),
    elevationGain: num(r.elevation_gain_m),
    elevationLoss: num(r.elevation_loss_m),
    elevationProfile: (r.elevation_profile as [number, number][] | null) ?? null,
    kmSplits: (r.km_splits as Split[] | null) ?? null,
    mileSplits: (r.mile_splits as Split[] | null) ?? null,
    bestEfforts: (r.best_efforts as Activity["bestEfforts"]) ?? {},
    hasGps: (r.has_gps as boolean | null) ?? null,
    workoutLogId: (r.workout_log_id as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    publicPath: geo?.coordinates ?? null,
  };
}

export type ActivityFilters = {
  type: Activity["type"] | null;
  from: string | null;
  to: string | null;
  before: string | null;
};

/** The caller's own activities, newest first, cursor-paged by start time. */
export async function listMyActivities(supabase: SupabaseClient, userId: string, f: ActivityFilters) {
  let q = supabase
    .from("activities")
    .select(COLUMNS)
    .eq("user_id", userId)
    // Registered but never uploaded (e.g. the tab was closed) is not history.
    .neq("status", "uploaded")
    .order("started_at", { ascending: false, nullsFirst: true })
    .order("id", { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE + 1);
  if (f.type) q = q.eq("activity_type", f.type);
  if (f.from) q = q.gte("started_at", f.from);
  if (f.to) q = q.lt("started_at", f.to);
  if (f.before) q = q.lt("started_at", f.before);
  const { data, error } = await q;
  if (error) throw new DatabaseQueryError("activities", error);
  const rows = (data ?? []).map(toActivity);
  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  const last = page[page.length - 1];
  return { activities: page, nextBefore: rows.length > ACTIVITY_PAGE_SIZE && last?.startedAt ? last.startedAt : null };
}

/** One activity as the caller may see it; the full track only for its owner. */
export async function getActivity(supabase: SupabaseClient, id: string, userId: string) {
  const { data, error } = await supabase.from("activities").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new DatabaseQueryError("activities", error);
  if (!data) return null;
  const activity = toActivity(data);
  const own = activity.userId === userId;
  let track: {
    path: [number, number][] | null;
    avgHeartRate: number | null;
    maxHeartRate: number | null;
    avgCadence: number | null;
  } | null = null;
  if (own && activity.status === "ready") {
    const { data: t, error: tError } = await supabase
      .from("activity_tracks")
      .select("avg_heart_rate, max_heart_rate, avg_cadence, activity_track_geojson")
      .eq("activity_id", id)
      .maybeSingle();
    if (tError) throw new DatabaseQueryError("activity_tracks", tError);
    if (t) {
      track = {
        path: (t.activity_track_geojson as { coordinates: [number, number][] } | null)?.coordinates ?? null,
        avgHeartRate: num(t.avg_heart_rate),
        maxHeartRate: num(t.max_heart_rate),
        avgCadence: num(t.avg_cadence),
      };
    }
  }
  return { activity, own, track };
}
