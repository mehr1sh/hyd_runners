import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export type FeedItem = {
  id: string;
  userId: string;
  authorName: string | null;
  type: "run" | "walk_run" | "walk" | "hike";
  name: string | null;
  visibility: "private" | "followers" | "public";
  startedAt: string;
  distanceM: number | null;
  movingSeconds: number | null;
  avgPace: number | null;
  elevationGain: number | null;
  path: [number, number][] | null;
  kudos: number;
  myKudos: boolean;
  comments: number;
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const FEED_PAGE = 20;

export async function loadFeed(supabase: SupabaseClient, before: string | null) {
  const { data, error } = await supabase.rpc("activity_feed", { p_before: before, p_limit: FEED_PAGE + 1 });
  if (error) throw new DatabaseQueryError("activity_feed", error);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r): FeedItem => ({
    id: r.id as string,
    userId: r.user_id as string,
    authorName: (r.author_name as string | null) ?? null,
    type: r.activity_type as FeedItem["type"],
    name: (r.name as string | null) ?? null,
    visibility: r.visibility as FeedItem["visibility"],
    startedAt: new Date(r.started_at as string).toISOString(),
    distanceM: n(r.distance_m),
    movingSeconds: n(r.moving_seconds),
    avgPace: n(r.avg_pace_s),
    elevationGain: n(r.elevation_gain_m),
    path: (r.route_geojson as { coordinates: [number, number][] } | null)?.coordinates ?? null,
    kudos: Number(r.kudos),
    myKudos: Boolean(r.my_kudos),
    comments: Number(r.comments),
  }));
  const page = rows.slice(0, FEED_PAGE);
  return { items: page, nextBefore: rows.length > FEED_PAGE ? page[page.length - 1].startedAt : null };
}

export type RunnerProfile = {
  id: string;
  displayName: string;
  bio: string | null;
  followers: number;
  following: number;
  approveFollowers: boolean;
  myFollow: "none" | "pending" | "accepted";
  followsMe: boolean;
  blockedByMe: boolean;
};

export async function getRunnerProfile(supabase: SupabaseClient, id: string): Promise<RunnerProfile | null> {
  const { data, error } = await supabase.rpc("runner_profile", { p_user: id });
  if (error) throw new DatabaseQueryError("runner_profile", error);
  const r = ((data ?? []) as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    bio: (r.bio as string | null) ?? null,
    followers: Number(r.followers),
    following: Number(r.following),
    approveFollowers: Boolean(r.approve_followers),
    myFollow: r.my_follow as RunnerProfile["myFollow"],
    followsMe: Boolean(r.follows_me),
    blockedByMe: Boolean(r.blocked_by_me),
  };
}

export async function searchRunners(supabase: SupabaseClient, q: string) {
  const { data, error } = await supabase.rpc("search_runners", { p_query: q, p_limit: 20 });
  if (error) {
    if (error.code === "22023") return [];
    throw new DatabaseQueryError("search_runners", error);
  }
  return ((data ?? []) as { id: string; display_name: string; bio: string | null }[]).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    bio: r.bio,
  }));
}

export type Connection = {
  userId: string;
  displayName: string | null;
  direction: "following" | "follower";
  status: "pending" | "accepted";
};

export async function myConnections(supabase: SupabaseClient, userId: string) {
  const [conn, blocks, settings] = await Promise.all([
    supabase.rpc("my_connections"),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", userId).limit(500),
    supabase.from("profiles").select("bio, approve_followers, discoverable").eq("id", userId).maybeSingle(),
  ]);
  if (conn.error) throw new DatabaseQueryError("my_connections", conn.error);
  if (blocks.error) throw new DatabaseQueryError("user_blocks", blocks.error);
  if (settings.error) throw new DatabaseQueryError("profiles", settings.error);
  const list = ((conn.data ?? []) as Record<string, unknown>[]).map((r): Connection => ({
    userId: r.user_id as string,
    displayName: (r.display_name as string | null) ?? null,
    direction: r.direction as Connection["direction"],
    status: r.status as Connection["status"],
  }));
  return {
    connections: list,
    blocked: ((blocks.data ?? []) as { blocked_id: string }[]).map((b) => b.blocked_id),
    settings: {
      bio: (settings.data?.bio as string | null) ?? "",
      approveFollowers: (settings.data?.approve_followers as boolean | undefined) ?? true,
      discoverable: (settings.data?.discoverable as boolean | undefined) ?? true,
    },
  };
}

export type ActivityComment = {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  hidden: boolean;
};

/** Kudos and comments on one activity, as the caller may see them. */
export async function activitySocial(supabase: SupabaseClient, activityId: string, userId: string) {
  const [kudos, mine, comments] = await Promise.all([
    supabase.from("activity_reactions").select("user_id", { count: "exact", head: true }).eq("activity_id", activityId),
    supabase
      .from("activity_reactions")
      .select("user_id")
      .eq("activity_id", activityId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.rpc("activity_comment_list", { p_activity_id: activityId }),
  ]);
  if (kudos.error) throw new DatabaseQueryError("activity_reactions", kudos.error);
  if (mine.error) throw new DatabaseQueryError("activity_reactions", mine.error);
  if (comments.error) throw new DatabaseQueryError("activity_comment_list", comments.error);
  return {
    kudos: kudos.count ?? 0,
    myKudos: Boolean(mine.data),
    comments: ((comments.data ?? []) as Record<string, unknown>[]).map((c): ActivityComment => ({
      id: c.id as string,
      authorId: c.author_id as string,
      authorName: (c.author_name as string | null) ?? null,
      body: c.body as string,
      createdAt: new Date(c.created_at as string).toISOString(),
      hidden: Boolean(c.hidden),
    })),
  };
}

/** A runner's activities the caller can see (RLS decides), newest first. */
export async function visibleActivitiesOf(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("activities")
    .select("id, name, activity_type, started_at, distance_m, visibility")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw new DatabaseQueryError("activities", error);
  return (data ?? []) as {
    id: string;
    name: string | null;
    activity_type: FeedItem["type"];
    started_at: string;
    distance_m: number | null;
    visibility: FeedItem["visibility"];
  }[];
}
