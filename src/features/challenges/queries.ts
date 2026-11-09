import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { ChallengeKind } from "./logic";

export type Challenge = {
  id: string;
  title: string;
  description: string;
  scope: "city" | "club";
  clubId: string | null;
  kind: ChallengeKind;
  goal: number;
  collective: boolean;
  startsAt: string;
  endsAt: string;
  rewardXp: number;
  rewardCoins: number;
  status: "draft" | "active" | "cancelled";
};

export type ChallengeProgress = {
  joined: boolean;
  progress: number | null;
  collectiveProgress: number | null;
  participants: number;
  completedAt: string | null;
};

const COLUMNS =
  "id, title, description, scope, club_id, kind, goal, collective, starts_at, ends_at, reward_xp, reward_coins, status";

function toChallenge(r: Record<string, unknown>): Challenge {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    scope: r.scope as Challenge["scope"],
    clubId: (r.club_id as string | null) ?? null,
    kind: r.kind as ChallengeKind,
    goal: Number(r.goal),
    collective: r.collective as boolean,
    startsAt: new Date(r.starts_at as string).toISOString(),
    endsAt: new Date(r.ends_at as string).toISOString(),
    rewardXp: r.reward_xp as number,
    rewardCoins: r.reward_coins as number,
    status: r.status as Challenge["status"],
  };
}

export async function progressFor(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ChallengeProgress>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc("my_challenge_progress", { p_challenge_ids: ids });
  if (error) throw new DatabaseQueryError("my_challenge_progress", error);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    map.set(r.challenge_id as string, {
      joined: r.joined as boolean,
      progress: r.progress === null ? null : Number(r.progress),
      collectiveProgress: r.collective_progress === null ? null : Number(r.collective_progress),
      participants: Number(r.participants),
      completedAt: (r.completed_at as string | null) ?? null,
    });
  }
  return map;
}

/** Open challenges the runner can see, and ones they joined that have ended (history). */
export async function listChallenges(supabase: SupabaseClient, userId: string, opts: { clubId?: string } = {}) {
  const nowIso = new Date().toISOString();
  let open = supabase
    .from("challenges")
    .select(COLUMNS)
    .eq("status", "active")
    .gt("ends_at", nowIso)
    .order("ends_at")
    .limit(50);
  if (opts.clubId) open = open.eq("club_id", opts.clubId);
  const [openRes, joinedRes] = await Promise.all([
    open,
    supabase
      .from("challenge_participants")
      .select("challenge_id")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(100),
  ]);
  if (openRes.error) throw new DatabaseQueryError("challenges", openRes.error);
  if (joinedRes.error) throw new DatabaseQueryError("challenge_participants", joinedRes.error);
  const openList = (openRes.data ?? []).map(toChallenge);
  const joinedIds = (joinedRes.data ?? [])
    .map((r) => r.challenge_id as string)
    .filter((id) => !openList.some((c) => c.id === id));
  let past: Challenge[] = [];
  if (joinedIds.length) {
    const { data, error } = await supabase
      .from("challenges")
      .select(COLUMNS)
      .in("id", joinedIds)
      .order("ends_at", { ascending: false })
      .limit(50);
    if (error) throw new DatabaseQueryError("challenges", error);
    past = (data ?? []).map(toChallenge);
  }
  const progress = await progressFor(
    supabase,
    [...openList, ...past].map((c) => c.id),
  );
  return { open: openList, past, progress };
}

export async function getChallenge(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("challenges").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new DatabaseQueryError("challenges", error);
  if (!data) return null;
  const challenge = toChallenge(data);
  const [progress, board, club] = await Promise.all([
    progressFor(supabase, [id]),
    supabase.rpc("challenge_leaderboard", { p_challenge_id: id, p_limit: 20 }),
    challenge.clubId
      ? supabase.from("clubs").select("slug, name").eq("id", challenge.clubId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (board.error) throw new DatabaseQueryError("challenge_leaderboard", board.error);
  return {
    now: Date.now(),
    challenge,
    progress: progress.get(id) ?? null,
    club: club.data as { slug: string; name: string } | null,
    leaderboard: ((board.data ?? []) as Record<string, unknown>[]).map((r) => ({
      rank: Number(r.rank),
      displayName: r.display_name as string,
      progress: Number(r.progress),
      completed: r.completed as boolean,
      isMe: r.is_me as boolean,
    })),
  };
}
