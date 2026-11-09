import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { SquadWeek } from "./logic";

function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

export type MatchingProfile = {
  optedIn: boolean;
  paceMin: number | null;
  paceMax: number | null;
  typicalKm: number | null;
  areas: string[];
  days: number[];
  times: string[];
  goals: string[];
  experience: string | null;
  groupSize: "partner" | "small_group" | "any";
  intro: string | null;
};

export async function myMatchingProfile(supabase: SupabaseClient, userId: string): Promise<MatchingProfile | null> {
  const r = check(
    "matching_profiles",
    await supabase.from("matching_profiles").select("*").eq("user_id", userId).maybeSingle(),
  ) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    optedIn: Boolean(r.opted_in),
    paceMin: (r.pace_min_s as number | null) ?? null,
    paceMax: (r.pace_max_s as number | null) ?? null,
    typicalKm: r.typical_km === null ? null : Number(r.typical_km),
    areas: (r.areas as string[]) ?? [],
    days: (r.days as number[]) ?? [],
    times: (r.times as string[]) ?? [],
    goals: (r.goals as string[]) ?? [],
    experience: (r.experience as string | null) ?? null,
    groupSize: r.group_size as MatchingProfile["groupSize"],
    intro: (r.intro as string | null) ?? null,
  };
}

export type Match = {
  userId: string;
  displayName: string;
  score: number;
  reasons: string[];
  intro: string | null;
  sharedAreas: string[];
  paceMin: number | null;
  paceMax: number | null;
  groupSize: string;
};

export async function findMatches(supabase: SupabaseClient): Promise<Match[]> {
  const rows = check("find_running_matches", await supabase.rpc("find_running_matches", { p_limit: 20 })) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    userId: r.user_id as string,
    displayName: r.display_name as string,
    score: Number(r.score),
    reasons: (r.reasons as string[]) ?? [],
    intro: (r.intro as string | null) ?? null,
    sharedAreas: (r.shared_areas as string[]) ?? [],
    paceMin: (r.pace_min_s as number | null) ?? null,
    paceMax: (r.pace_max_s as number | null) ?? null,
    groupSize: r.group_size as string,
  }));
}

export type SquadSummary = {
  id: string;
  name: string;
  description: string | null;
  weeklyKmTarget: number | null;
  joinPolicy: "invite_only" | "request";
  maxMembers: number;
  myStatus: "invited" | "requested" | "active" | null;
  myRole: "captain" | "member" | null;
};

export async function mySquads(supabase: SupabaseClient, userId: string) {
  const [mine, open] = await Promise.all([
    supabase
      .from("squad_members")
      .select(
        "status, role, squads!inner(id, name, description, weekly_km_target, join_policy, max_members, archived_at)",
      )
      .eq("user_id", userId),
    supabase
      .from("squads")
      .select("id, name, description, weekly_km_target, join_policy, max_members")
      .eq("join_policy", "request")
      .is("archived_at", null)
      .limit(30),
  ]);
  const rows = check("squad_members", mine) as Record<string, unknown>[];
  const squads: SquadSummary[] = rows
    .filter((r) => !(r.squads as { archived_at: string | null }).archived_at)
    .map((r) => {
      const s = r.squads as Record<string, unknown>;
      return {
        id: s.id as string,
        name: s.name as string,
        description: (s.description as string | null) ?? null,
        weeklyKmTarget: s.weekly_km_target === null ? null : Number(s.weekly_km_target),
        joinPolicy: s.join_policy as SquadSummary["joinPolicy"],
        maxMembers: Number(s.max_members),
        myStatus: r.status as SquadSummary["myStatus"],
        myRole: r.role as SquadSummary["myRole"],
      };
    });
  const mineIds = new Set(squads.map((s) => s.id));
  const openSquads = (check("squads", open) as Record<string, unknown>[])
    .filter((s) => !mineIds.has(s.id as string))
    .map((s) => ({
      id: s.id as string,
      name: s.name as string,
      description: (s.description as string | null) ?? null,
      weeklyKmTarget: s.weekly_km_target === null ? null : Number(s.weekly_km_target),
      joinPolicy: "request" as const,
      maxMembers: Number(s.max_members),
      myStatus: null,
      myRole: null,
    }));
  return { squads, openSquads };
}

export type SquadDashboard = {
  members: { userId: string; name: string; role: string; weekKm: number; weekActiveDays: number; attended: number }[];
  weeks: SquadWeek[];
  challenges: {
    id: string;
    title: string;
    kind: string;
    goal: number;
    endsAt: string;
    members: { name: string; progress: number; completed: boolean }[] | null;
  }[];
};

export async function squadDetail(supabase: SupabaseClient, squadId: string, userId: string) {
  const [squad, roster, dash, messages, runs, attendance] = await Promise.all([
    supabase
      .from("squads")
      .select("id, name, description, weekly_km_target, join_policy, max_members")
      .eq("id", squadId)
      .maybeSingle(),
    supabase
      .from("squad_members")
      .select("user_id, role, status, profiles!squad_members_user_id_fkey(display_name)")
      .eq("squad_id", squadId),
    supabase.rpc("squad_dashboard", { p_squad: squadId }),
    supabase
      .from("squad_messages")
      .select("id, author_id, body, created_at, hidden_at, author:profiles!squad_messages_author_id_fkey(display_name)")
      .eq("squad_id", squadId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("squad_runs")
      .select("id, title, starts_at, meeting_point, notes, created_by")
      .eq("squad_id", squadId)
      .order("starts_at")
      .limit(30),
    supabase.from("squad_run_attendance").select("run_id, user_id, status"),
  ]);
  const s = check("squads", squad) as Record<string, unknown> | null;
  if (!s) return null;
  const members = (check("squad_members", roster) as Record<string, unknown>[]).map((m) => ({
    userId: m.user_id as string,
    role: m.role as string,
    status: m.status as string,
    name: ((m.profiles as { display_name?: string } | null)?.display_name as string | undefined) ?? "A runner",
  }));
  const me = members.find((m) => m.userId === userId);
  return {
    id: s.id as string,
    name: s.name as string,
    description: (s.description as string | null) ?? null,
    weeklyKmTarget: s.weekly_km_target === null ? null : Number(s.weekly_km_target),
    joinPolicy: s.join_policy as "invite_only" | "request",
    maxMembers: Number(s.max_members),
    me: me ?? null,
    members,
    dashboard: dash.error ? null : (dash.data as SquadDashboard),
    messages: (messages.error ? [] : (messages.data as Record<string, unknown>[])).map((m) => ({
      id: m.id as string,
      authorId: m.author_id as string,
      body: m.body as string,
      createdAt: m.created_at as string,
      hidden: Boolean(m.hidden_at),
      author: ((m.author as { display_name?: string } | null)?.display_name as string | undefined) ?? "A runner",
    })),
    runs: (runs.error ? [] : (runs.data as Record<string, unknown>[])).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      startsAt: r.starts_at as string,
      meetingPoint: r.meeting_point as string,
      notes: (r.notes as string | null) ?? null,
      createdBy: r.created_by as string,
    })),
    attendance: attendance.error ? [] : (attendance.data as { run_id: string; user_id: string; status: string }[]),
  };
}
