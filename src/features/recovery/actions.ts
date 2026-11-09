"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { callerTimezone } from "@/features/scheduler/server/data";
import { addDays, localDate, weekStart } from "@/features/gamification/logic/time";
import { EXERCISE_BY_KEY, MUSCLES, STRENGTH_SESSIONS } from "@/features/training/logic/strength-templates";
import { preferredStartTime, profileLevel, toStoredChange } from "@/features/training/server/data";
import type { Change } from "@/features/training/logic/adapt";
import { returnDays, RETURN_RULES, sessionMinutes, sessionTitle, weeksFor } from "./logic/return-to-run";

export type RecoveryState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  const supabase = await createClient();
  const timezone = await callerTimezone(supabase, user.id);
  return { user, supabase, timezone, today: localDate(new Date(), timezone) } as const;
}

function dbMessage(code?: string) {
  if (code === "PT429") return "You're doing that a lot. Please wait a little and try again.";
  if (code === "22023") return "Entries can be for today or the last 60 days.";
  if (code === "23514") return "Fill in at least one thing.";
  return "Something went wrong. Please try again.";
}

const scale = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().int().min(1).max(5).nullable(),
);
const ACTIVITIES = ["stretching", "foam_rolling", "mobility", "massage", "yoga", "walk", "rest", "other"] as const;

const Entry = z.object({
  date: z.iso.date(),
  sleepQuality: scale,
  fatigue: scale,
  soreness: scale,
  stress: scale,
  energy: scale,
  sleepHours: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(16).nullable()),
  workoutRpe: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(1).max(10).nullable(),
  ),
  sorenessAreas: z.array(z.enum(MUSCLES)).max(13),
  recoveryActivities: z.array(z.enum(ACTIVITIES)).max(8),
  notes: z.string().trim().max(500, "Notes can be up to 500 characters."),
  shareWithCoach: z.boolean(),
});

export async function saveEntry(_p: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Entry.safeParse({
    date: fd.get("date"),
    sleepQuality: fd.get("sleepQuality"),
    fatigue: fd.get("fatigue"),
    soreness: fd.get("soreness"),
    stress: fd.get("stress"),
    energy: fd.get("energy"),
    sleepHours: fd.get("sleepHours"),
    workoutRpe: fd.get("workoutRpe"),
    sorenessAreas: fd.getAll("sorenessAreas"),
    recoveryActivities: fd.getAll("recoveryActivities"),
    notes: fd.get("notes") ?? "",
    shareWithCoach: fd.get("shareWithCoach") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const e = parsed.data;
  if (e.date > s.today || e.date < addDays(s.today, -60)) return { status: "error", message: dbMessage("22023") };
  const row = {
    sleep_quality: e.sleepQuality,
    sleep_hours: e.sleepHours,
    fatigue: e.fatigue,
    soreness: e.soreness,
    soreness_areas: e.sorenessAreas,
    stress: e.stress,
    energy: e.energy,
    workout_rpe: e.workoutRpe,
    recovery_activities: e.recoveryActivities,
    notes: e.notes || null,
    share_with_coach: e.shareWithCoach,
  };
  const existing = await s.supabase
    .from("recovery_entries")
    .select("id")
    .eq("user_id", s.user.id)
    .eq("entry_date", e.date)
    .maybeSingle();
  const res = existing.data
    ? await s.supabase.from("recovery_entries").update(row).eq("id", existing.data.id)
    : await s.supabase.from("recovery_entries").insert({ ...row, user_id: s.user.id, entry_date: e.date });
  if (res.error) return { status: "error", message: dbMessage(res.error.code) };
  revalidatePath("/recovery");
  return { status: "success", message: `Saved your entry for ${e.date}.` };
}

export async function deleteEntry(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  await s.supabase.from("recovery_entries").delete().eq("id", id.data).eq("user_id", s.user.id);
  revalidatePath("/recovery");
  redirect("/recovery");
}

const Log = z.object({
  date: z.iso.date(),
  sessionKey: z.enum(
    Object.keys(STRENGTH_SESSIONS) as [keyof typeof STRENGTH_SESSIONS, ...(keyof typeof STRENGTH_SESSIONS)[]],
  ),
  minutes: z.coerce.number().int().min(5).max(180),
  exercises: z.array(z.string()).min(1, "Tick at least one exercise you did."),
  sets: z.coerce.number().int().min(1).max(10),
});

export async function logStrength(_p: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Log.safeParse({
    date: fd.get("date"),
    sessionKey: fd.get("sessionKey"),
    minutes: fd.get("minutes"),
    exercises: fd.getAll("exercises"),
    sets: fd.get("sets"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const l = parsed.data;
  if (l.date > s.today || l.date < addDays(s.today, -60))
    return { status: "error", message: "Logs can be for today or the last 60 days." };
  const session = STRENGTH_SESSIONS[l.sessionKey];
  const allowed = new Set<string>(session.exercises);
  if (l.exercises.some((k) => !allowed.has(k) || !EXERCISE_BY_KEY.has(k)))
    return { status: "error", message: "Unknown exercise." };
  const { error } = await s.supabase.from("strength_logs").insert({
    user_id: s.user.id,
    performed_on: l.date,
    title: session.title,
    session_key: l.sessionKey,
    minutes: l.minutes,
    exercises: l.exercises.map((key) => ({ key, sets: l.sets })),
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/strength");
  revalidatePath("/recovery");
  return { status: "success", message: `Logged ${session.title.toLowerCase()} on ${l.date}.` };
}

export async function deleteStrengthLog(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  await s.supabase.from("strength_logs").delete().eq("id", id.data).eq("user_id", s.user.id);
  revalidatePath("/strength");
}

export async function proposeReturnToRun(_p: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  if (fd.get("acknowledge") !== "on")
    return { status: "error", message: "Please confirm the statement about professional advice first." };
  const [level, start] = await Promise.all([
    profileLevel(s.supabase, s.user.id),
    preferredStartTime(s.supabase, s.user.id),
  ]);
  const days = returnDays(6);
  const firstWeek = addDays(weekStart(s.today), 7);
  const changes: Change[] = weeksFor(level).flatMap((w, i) =>
    days.map((d): Change => {
      const date = addDays(firstWeek, 7 * i + d - 1);
      return {
        op: "add",
        title: sessionTitle(w),
        workout_type: w.walk === 0 ? "run" : "walk_run",
        date,
        start_time: start,
        duration_minutes: sessionMinutes(w),
        rationale: [`Return to running, week ${w.week}.`, ...(w.note ? [w.note] : [])],
        details: { kind: "return_to_run", week: w.week, run: w.run, walk: w.walk, reps: w.reps },
        label: `Week ${w.week}, ${date}: ${sessionTitle(w)} (${sessionMinutes(w)} min with warm-up and cool-down)`,
      };
    }),
  );
  const { error } = await s.supabase.from("training_proposals").insert({
    user_id: s.user.id,
    kind: "return_to_run",
    title: `Return to running: ${changes.length / 3} weeks`,
    summary:
      "Walk-run sessions three times a week, building to continuous easy running. General training guidance, not a rehabilitation plan; your coach can review it.",
    reasons: RETURN_RULES,
    changes: changes.map((c) => toStoredChange(c, s.timezone)),
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  return { status: "success", message: "Proposed. Review and accept it under Race prep → Proposed changes." };
}
