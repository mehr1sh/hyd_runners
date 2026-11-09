"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { parsePace } from "@/features/events/logic";
import { AREAS, GOALS } from "./logic";

export type SquadState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}

function dbMessage(code?: string, message?: string) {
  if (code === "PT429") return "You're doing that a lot. Please wait a little and try again.";
  if (code === "23505") return "Already done.";
  if (code === "42501") return "That isn't possible for you in this squad.";
  if (code === "22023")
    return message ? message.charAt(0).toUpperCase() + message.slice(1) + "." : "Check the details.";
  return "Something went wrong. Please try again.";
}

const Matching = z.object({
  optedIn: z.boolean(),
  paceMin: z.string(),
  paceMax: z.string(),
  typicalKm: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(60).nullable()),
  areas: z.array(z.enum(Object.keys(AREAS) as [keyof typeof AREAS])).max(5, "Choose up to five areas."),
  days: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  times: z.array(z.enum(["early_morning", "morning", "afternoon", "evening", "night"])).max(5),
  goals: z.array(z.enum(Object.keys(GOALS) as [keyof typeof GOALS])).max(6),
  experience: z.enum(["new_to_running", "returning", "regular"]).nullable(),
  groupSize: z.enum(["partner", "small_group", "any"]),
  intro: z.string().trim().max(160),
});

export async function saveMatchingProfile(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Matching.safeParse({
    optedIn: fd.get("optedIn") === "on",
    paceMin: fd.get("paceMin") ?? "",
    paceMax: fd.get("paceMax") ?? "",
    typicalKm: fd.get("typicalKm"),
    areas: fd.getAll("areas"),
    days: fd.getAll("days"),
    times: fd.getAll("times"),
    goals: fd.getAll("goals"),
    experience: fd.get("experience") || null,
    groupSize: fd.get("groupSize") ?? "any",
    intro: fd.get("intro") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const m = parsed.data;
  const pMin = parsePace(m.paceMin);
  const pMax = parsePace(m.paceMax);
  if (Number.isNaN(pMin) || Number.isNaN(pMax))
    return { status: "error", message: "Write paces as m:ss, for example 6:00." };
  if (pMin !== null && pMax !== null && pMin > pMax)
    return { status: "error", message: "The faster pace comes first." };
  if (m.optedIn && m.areas.length === 0) return { status: "error", message: "Choose at least one area to be matched." };
  const row = {
    opted_in: m.optedIn,
    pace_min_s: pMin,
    pace_max_s: pMax,
    typical_km: m.typicalKm,
    areas: m.areas,
    days: m.days,
    times: m.times,
    goals: m.goals,
    experience: m.experience,
    group_size: m.groupSize,
    intro: m.intro || null,
  };
  const exists = await s.supabase.from("matching_profiles").select("user_id").eq("user_id", s.user.id).maybeSingle();
  const res = exists.data
    ? await s.supabase.from("matching_profiles").update(row).eq("user_id", s.user.id)
    : await s.supabase.from("matching_profiles").insert({ ...row, user_id: s.user.id });
  if (res.error) return { status: "error", message: dbMessage(res.error.code) };
  revalidatePath("/matching");
  return {
    status: "success",
    message: m.optedIn ? "Saved. You appear in matching." : "Saved. You're hidden from matching.",
  };
}

export async function dismissMatch(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("userId"));
  if (!id.success) return;
  await s.supabase.from("match_dismissals").insert({ user_id: s.user.id, other_id: id.data });
  revalidatePath("/matching");
}

const NewSquad = z.object({
  name: z.string().trim().min(2, "Name your squad.").max(60),
  description: z.string().trim().max(500),
  weeklyKm: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(1000).nullable()),
  joinPolicy: z.enum(["invite_only", "request"]),
  maxMembers: z.coerce.number().int().min(2).max(8),
});

export async function createSquad(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = NewSquad.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const n = parsed.data;
  const { data, error } = await s.supabase.rpc("create_squad", {
    p_name: n.name,
    p_description: n.description,
    p_weekly_km: n.weeklyKm,
    p_join_policy: n.joinPolicy,
    p_max: n.maxMembers,
  });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  redirect(`/squads/${data}`);
}

const ACTIONS = ["invite", "request", "accept", "approve", "decline", "leave", "remove", "make_captain"] as const;

export async function squadAction(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z.object({ squadId: z.uuid(), userId: z.uuid(), action: z.enum(ACTIONS) }).safeParse({
    squadId: fd.get("squadId"),
    userId: fd.get("userId") || s.user.id,
    action: fd.get("action"),
  });
  if (!parsed.success) return { status: "error", message: "Check the form." };
  const { squadId, userId, action } = parsed.data;
  const { error } = await s.supabase.rpc("squad_membership", { p_squad: squadId, p_user: userId, p_action: action });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath("/squads", "layout");
  revalidatePath("/matching");
  const done: Record<(typeof ACTIONS)[number], string> = {
    invite: "Invitation sent.",
    request: "Request sent to the captains.",
    accept: "Welcome to the squad.",
    approve: "Approved.",
    decline: "Declined.",
    leave: "You left the squad.",
    remove: "Removed from the squad.",
    make_captain: "They're now a captain.",
  };
  return { status: "success", message: done[action] };
}

export async function postSquadMessage(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({ squadId: z.uuid(), body: z.string().trim().min(1, "Write a message.").max(1000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the message." };
  const { error } = await s.supabase
    .from("squad_messages")
    .insert({ squad_id: parsed.data.squadId, body: parsed.data.body });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath(`/squads/${parsed.data.squadId}`);
  return { status: "success" };
}

export async function reportSquadMessage(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({ messageId: z.uuid(), reason: z.enum(["harassment", "spam", "inappropriate", "safety", "other"]) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Choose a reason." };
  const { error } = await s.supabase.rpc("report_content", {
    p_target_type: "squad_message",
    p_target_id: parsed.data.messageId,
    p_reason: parsed.data.reason,
    p_details: null,
  });
  if (error)
    return {
      status: "error",
      message: error.code === "23505" ? "You've already reported this." : dbMessage(error.code),
    };
  return { status: "success", message: "Thanks. A moderator will review it." };
}

const Run = z.object({
  squadId: z.uuid(),
  title: z.string().trim().min(2, "Name the run.").max(80),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  meetingPoint: z.string().trim().min(2, "Where do you meet?").max(120),
  notes: z.string().trim().max(500),
});

export async function addSquadRun(_p: SquadState, fd: FormData): Promise<SquadState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Run.safeParse({ ...Object.fromEntries(fd), notes: fd.get("notes") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const r = parsed.data;
  const startsAt = new Date(`${r.date}T${r.time}:00+05:30`).toISOString();
  const { error } = await s.supabase.from("squad_runs").insert({
    squad_id: r.squadId,
    title: r.title,
    starts_at: startsAt,
    meeting_point: r.meetingPoint,
    notes: r.notes || null,
  });
  if (error) return { status: "error", message: dbMessage(error.code, "runs must be in the future") };
  revalidatePath(`/squads/${r.squadId}`);
  return { status: "success", message: "Added to the squad calendar." };
}

export async function setAttendance(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const parsed = z
    .object({ runId: z.uuid(), squadId: z.uuid(), status: z.enum(["going", "attended", "not_going"]) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  // Update first; insert when there is no row yet (runners can't update the key columns an upsert would set).
  const { data: updated } = await s.supabase
    .from("squad_run_attendance")
    .update({ status: parsed.data.status })
    .eq("run_id", parsed.data.runId)
    .eq("user_id", s.user.id)
    .select("run_id");
  if (!updated?.length)
    await s.supabase
      .from("squad_run_attendance")
      .insert({ run_id: parsed.data.runId, user_id: s.user.id, status: parsed.data.status });
  revalidatePath(`/squads/${parsed.data.squadId}`);
}
