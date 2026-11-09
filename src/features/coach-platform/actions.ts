"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { callerTimezone } from "@/features/scheduler/server/data";
import { toStoredChange } from "@/features/training/server/data";

export type CoachState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}

function dbMessage(code?: string) {
  if (code === "PT429") return "You're doing that a lot. Please wait a little and try again.";
  if (code === "42501") return "You're not this runner's current coach.";
  if (code === "22023") return "Check the details: a session may already have changed.";
  return "Something went wrong. Please try again.";
}

const Note = z.object({
  runnerId: z.uuid(),
  kind: z.enum(["workout_feedback", "progress_note", "recommendation"]),
  body: z.string().trim().min(1, "Write something first.").max(2000),
  activityId: z.uuid().optional(),
});

export async function addCoachNote(_p: CoachState, fd: FormData): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Note.safeParse({ ...Object.fromEntries(fd), activityId: fd.get("activityId") || undefined });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const n = parsed.data;
  const { error } = await s.supabase
    .from("coach_notes")
    .insert({ runner_id: n.runnerId, kind: n.kind, body: n.body, activity_id: n.activityId ?? null });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath(`/coach/runners/${n.runnerId}`);
  return { status: "success", message: "Sent to your runner." };
}

export async function replyToNote(_p: CoachState, fd: FormData): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({ noteId: z.uuid(), body: z.string().trim().min(1, "Write a reply first.").max(1000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const { error } = await s.supabase
    .from("coach_note_replies")
    .insert({ note_id: parsed.data.noteId, body: parsed.data.body });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  revalidatePath("/coach", "layout");
  return { status: "success", message: "Reply sent." };
}

const Proposal = z.object({
  runnerId: z.uuid(),
  title: z.string().trim().min(3, "Give the proposal a title.").max(120),
  reason: z.string().trim().min(3, "Explain why.").max(500),
  shorten: z.array(z.string()).max(20),
  cancel: z.array(z.uuid()).max(20),
  addTitle: z.string().trim().max(120).optional(),
  addType: z.enum(["run", "walk_run", "strength", "mobility", "walk", "cross_training"]).optional(),
  addDate: z.iso.date().optional(),
  addTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  addMinutes: z.coerce.number().int().min(5).max(300).optional(),
});

export async function proposeForRunner(_p: CoachState, fd: FormData): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const opt = (k: string) => fd.get(k) || undefined;
  const parsed = Proposal.safeParse({
    runnerId: fd.get("runnerId"),
    title: fd.get("title"),
    reason: fd.get("reason"),
    shorten: fd.getAll("shorten").filter(Boolean),
    cancel: fd.getAll("cancel").filter(Boolean),
    addTitle: opt("addTitle"),
    addType: opt("addType"),
    addDate: opt("addDate"),
    addTime: opt("addTime"),
    addMinutes: opt("addMinutes"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  const changes: Record<string, unknown>[] = [];
  for (const entry of p.shorten) {
    const [id, minutes] = entry.split(":");
    if (!z.uuid().safeParse(id).success || !(Number(minutes) >= 5)) continue;
    changes.push({
      op: "shorten",
      workout_id: id,
      duration_minutes: Number(minutes),
      label: `Shorten a session to ${minutes} min`,
    });
  }
  for (const id of p.cancel) changes.push({ op: "cancel", workout_id: id, label: "Remove a session" });
  if (p.addTitle && p.addType && p.addDate && p.addTime && p.addMinutes) {
    const { data } = await s.supabase.rpc("coach_runner_overview", { p_runner: p.runnerId });
    const tz = ((data as { timezone?: string } | null)?.timezone ??
      (await callerTimezone(s.supabase, s.user.id))) as string;
    changes.push(
      toStoredChange(
        {
          op: "add",
          title: p.addTitle,
          workout_type: p.addType,
          date: p.addDate,
          start_time: p.addTime,
          duration_minutes: p.addMinutes,
          rationale: [`From your coach: ${p.reason}`],
          details: null,
          label: `Add "${p.addTitle}" on ${p.addDate} at ${p.addTime} (${p.addMinutes} min)`,
        },
        tz,
      ),
    );
  }
  if (changes.length === 0) return { status: "error", message: "Choose at least one change." };
  const { error } = await s.supabase.rpc("coach_propose_changes", {
    p_runner: p.runnerId,
    p_title: p.title,
    p_summary: p.reason,
    p_reasons: [p.reason],
    p_changes: changes,
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath(`/coach/runners/${p.runnerId}`);
  return { status: "success", message: "Proposed. Your runner will review it; nothing changes until they accept." };
}

export async function setCoachSharing(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  await s.supabase
    .from("profiles")
    .update({ coach_sees_training: fd.get("share") === "on" })
    .eq("id", s.user.id);
  revalidatePath("/training");
}

const Profile = z.object({
  profession: z.enum(["running_coach", "strength_coach", "physiotherapist", "nutritionist", "run_captain"]),
  headline: z.string().trim().max(120),
  bio: z.string().trim().max(2000),
  experienceYears: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(0).max(60).nullable(),
  ),
  specializations: z.string().trim().max(400),
  credName: z.array(z.string().trim().max(120)),
  credIssuer: z.array(z.string().trim().max(120)),
  credYear: z.array(z.string().trim().max(4)),
  credRef: z.array(z.string().trim().max(80)),
  listed: z.boolean(),
});

export async function saveProfessionalProfile(_p: CoachState, fd: FormData): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Profile.safeParse({
    profession: fd.get("profession"),
    headline: fd.get("headline") ?? "",
    bio: fd.get("bio") ?? "",
    experienceYears: fd.get("experienceYears"),
    specializations: fd.get("specializations") ?? "",
    credName: fd.getAll("credName"),
    credIssuer: fd.getAll("credIssuer"),
    credYear: fd.getAll("credYear"),
    credRef: fd.getAll("credRef"),
    listed: fd.get("listed") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  const credentials = p.credName
    .map((name, i) => ({
      name,
      issuer: p.credIssuer[i] || undefined,
      year: /^\d{4}$/.test(p.credYear[i] ?? "") ? Number(p.credYear[i]) : undefined,
      reference: p.credRef[i] || undefined,
    }))
    .filter((c) => c.name);
  const row = {
    profession: p.profession,
    headline: p.headline || null,
    bio: p.bio || null,
    experience_years: p.experienceYears,
    specializations: p.specializations
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 10),
    credentials,
    listed: p.listed,
  };
  const existing = await s.supabase
    .from("professional_profiles")
    .select("user_id")
    .eq("user_id", s.user.id)
    .maybeSingle();
  const res = existing.data
    ? await s.supabase.from("professional_profiles").update(row).eq("user_id", s.user.id)
    : await s.supabase.from("professional_profiles").insert({ ...row, user_id: s.user.id });
  if (res.error) return { status: "error", message: dbMessage(res.error.code) };
  revalidatePath("/coach/profile");
  return {
    status: "success",
    message: "Profile saved. Changing credentials sends a verified profile back for review.",
  };
}

export async function requestVerification(): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const { error } = await s.supabase.rpc("request_professional_verification");
  if (error)
    return {
      status: "error",
      message:
        error.code === "22023"
          ? "Add at least one credential first, or wait for the current review."
          : dbMessage(error.code),
    };
  revalidatePath("/coach/profile");
  return { status: "success", message: "Review requested. An administrator will check your credentials." };
}

export async function reviewProfessional(_p: CoachState, fd: FormData): Promise<CoachState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      userId: z.uuid(),
      status: z.enum(["verified", "rejected", "suspended", "unverified"]),
      note: z.string().trim().max(500),
    })
    .safeParse({ userId: fd.get("userId"), status: fd.get("status"), note: fd.get("note") ?? "" });
  if (!parsed.success) return { status: "error", message: "Check the form." };
  if (parsed.data.status === "verified" && parsed.data.note.length < 5)
    return { status: "error", message: "Record how you checked the credentials before verifying." };
  const { error } = await s.supabase.rpc("review_professional", {
    p_user: parsed.data.userId,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error)
    return {
      status: "error",
      message: error.code === "42501" ? "Only admins can review, and not their own profile." : dbMessage(error.code),
    };
  revalidatePath("/manager/professionals");
  return { status: "success", message: `Marked as ${parsed.data.status}.` };
}

export async function markAllRead() {
  const s = await ctx();
  if ("error" in s) return;
  await s.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", s.user.id)
    .is("read_at", null);
  revalidatePath("/notifications");
}
