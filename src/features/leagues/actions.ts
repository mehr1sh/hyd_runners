"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { joinCode, LEAGUE_KINDS, SCORING_LABEL, scoringFor, type LeagueKind, type ScoringKey } from "./logic";

export type LeagueState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}

function dbMessage(code?: string, message?: string) {
  if (code === "42501")
    return message?.includes("code")
      ? "That code isn't right."
      : message?.includes("club")
        ? "Join the club first."
        : "You can't do that in this league.";
  if (code === "23505")
    return message?.includes("team in this league")
      ? "You're already in a team in this league."
      : "That name is taken.";
  if (code === "22023")
    return message ? message.charAt(0).toUpperCase() + message.slice(1) + "." : "Check the details.";
  if (code === "PT429") return "Too many attempts. Please wait a little.";
  return "Something went wrong. Please try again.";
}

const NewLeague = z.object({
  name: z.string().trim().min(3, "Name the league.").max(80),
  kind: z.enum(Object.keys(LEAGUE_KINDS) as [LeagueKind, ...LeagueKind[]]),
  description: z.string().trim().max(1000),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});

export async function createLeague(_p: LeagueState, fd: FormData): Promise<LeagueState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = NewLeague.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const l = parsed.data;
  if (l.endsOn < l.startsOn) return { status: "error", message: "The league must end after it starts." };
  const { data, error } = await s.supabase
    .from("leagues")
    .insert({
      name: l.name,
      kind: l.kind,
      description: l.description || null,
      starts_on: l.startsOn,
      ends_on: l.endsOn,
      scoring: scoringFor(l.kind),
    })
    .select("id")
    .single();
  if (error)
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only programme managers and admins create leagues."
          : dbMessage(error.code, error.message),
    };
  redirect(`/leagues/${data.id}`);
}

export async function updateLeague(_p: LeagueState, fd: FormData): Promise<LeagueState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const id = z.uuid().safeParse(fd.get("leagueId"));
  if (!id.success) return { status: "error", message: "League not found." };
  const scoring = Object.fromEntries(
    (Object.keys(SCORING_LABEL) as ScoringKey[]).map((k) => [
      k,
      Math.max(0, Math.min(100, Number(fd.get(`w_${k}`) ?? 0) || 0)),
    ]),
  );
  const status = z.enum(["draft", "active", "completed", "cancelled"]).safeParse(fd.get("status"));
  const { error } = await s.supabase
    .from("leagues")
    .update({ scoring, ...(status.success ? { status: status.data } : {}) })
    .eq("id", id.data);
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath(`/leagues/${id.data}`);
  return { status: "success", message: "League updated." };
}

const Team = z.object({
  leagueId: z.uuid(),
  name: z.string().trim().min(2, "Name the team.").max(60),
  affiliation: z.enum(["club", "university", "corporate", "custom"]),
  clubId: z.uuid().optional(),
});

export async function addTeam(_p: LeagueState, fd: FormData): Promise<LeagueState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Team.safeParse({ ...Object.fromEntries(fd), clubId: fd.get("clubId") || undefined });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const t = parsed.data;
  if (t.affiliation === "club" && !t.clubId) return { status: "error", message: "Choose the club." };
  const { error } = await s.supabase.from("league_teams").insert({
    league_id: t.leagueId,
    name: t.name,
    affiliation: t.affiliation,
    club_id: t.affiliation === "club" ? t.clubId : null,
    join_code: t.affiliation === "club" ? null : joinCode(),
  });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath(`/leagues/${t.leagueId}`);
  return { status: "success", message: "Team added." };
}

export async function joinTeam(_p: LeagueState, fd: FormData): Promise<LeagueState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({ teamId: z.uuid(), leagueId: z.uuid(), code: z.string().trim().max(20).optional() })
    .safeParse({
      teamId: fd.get("teamId"),
      leagueId: fd.get("leagueId"),
      code: fd.get("code") || undefined,
    });
  if (!parsed.success) return { status: "error", message: "Check the form." };
  const { error } = await s.supabase.rpc("join_league_team", {
    p_team: parsed.data.teamId,
    p_code: parsed.data.code ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath(`/leagues/${parsed.data.leagueId}`);
  return { status: "success", message: "You're in. Your activities count from the league's start date." };
}

export async function leaveLeague(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("leagueId"));
  if (!id.success) return;
  await s.supabase.from("league_members").delete().eq("league_id", id.data).eq("user_id", s.user.id);
  revalidatePath(`/leagues/${id.data}`);
}
