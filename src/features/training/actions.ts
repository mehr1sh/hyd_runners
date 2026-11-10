"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { callerTimezone } from "@/features/scheduler/server/data";
import { addDays, localDate } from "@/features/gamification/logic/time";
import { adaptiveProposal, missedSessionProposal } from "./logic/adapt";
import { parseClock } from "./logic/pace";
import { buildRacePlanProposal } from "./server/race-plan-proposal";
import { activeGoal, overdueSessions, past14Stats, sessionsBetween, toStoredChange } from "./server/data";
import { recentFatigue } from "@/features/recovery/server/queries";

export type TrainingState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  const supabase = await createClient();
  const timezone = await callerTimezone(supabase, user.id);
  return { user, supabase, timezone, today: localDate(new Date(), timezone) } as const;
}

function dbMessage(code: string | undefined, fallback = "Something went wrong. Please try again.") {
  if (code === "PT429") return "You're doing that a lot. Please wait a little and try again.";
  if (code === "23505") return "That's already been decided.";
  if (code === "P0002") return "Your schedule has changed since this was proposed. Ask for a fresh proposal.";
  if (code === "22023") return "Check the details and try again.";
  return fallback;
}

const GoalForm = z.object({
  distance: z.enum(["5k", "10k", "half", "marathon"]),
  raceDate: z.iso.date("Choose the race date."),
  name: z.string().trim().max(120).optional(),
  target: z.string().trim().max(10).optional(),
  level: z.enum(["new_to_running", "returning", "regular"]),
  daysPerWeek: z.coerce.number().int().min(2).max(6),
  longRunDay: z.coerce.number().int().min(1).max(7),
  eventId: z.uuid().optional(),
});

export async function saveRaceGoal(_p: TrainingState, fd: FormData): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = GoalForm.safeParse({
    ...Object.fromEntries(fd),
    name: fd.get("name") || undefined,
    target: fd.get("target") || undefined,
    eventId: fd.get("eventId") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const g = parsed.data;
  if (g.raceDate <= s.today || g.raceDate > addDays(s.today, 365))
    return { status: "error", message: "Choose a race date within the next year." };
  let target: number | null = null;
  if (g.target) {
    target = parseClock(g.target);
    if (target === null || target < 600 || target > 36000)
      return { status: "error", message: "Write the target time as h:mm:ss or mm:ss, or leave it empty." };
  }
  // One active goal: close any current one first.
  await s.supabase.from("race_goals").update({ status: "abandoned" }).eq("user_id", s.user.id).eq("status", "active");
  const { error } = await s.supabase.from("race_goals").insert({
    user_id: s.user.id,
    distance: g.distance,
    race_date: g.raceDate,
    name: g.name || null,
    event_id: g.eventId ?? null,
    target_seconds: target,
    current_level: g.level,
    days_per_week: g.daysPerWeek,
    long_run_day: g.longRunDay,
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  return { status: "success", message: "Race goal saved. Generate a plan when you're ready." };
}

export async function closeRaceGoal(_p: TrainingState, fd: FormData): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const status = fd.get("outcome") === "completed" ? "completed" : "abandoned";
  const { error } = await s.supabase
    .from("race_goals")
    .update({ status })
    .eq("user_id", s.user.id)
    .eq("status", "active");
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  return { status: "success", message: status === "completed" ? "Goal marked as completed." : "Goal closed." };
}

export async function proposeRacePlan(): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const built = await buildRacePlanProposal(s.supabase, s.user.id, s.timezone, s.today);
  if ("error" in built) return { status: "error", message: built.error };
  const { error } = await s.supabase.from("training_proposals").insert(built.row);
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  return { status: "success", message: "Plan proposed. Review it below." };
}

export async function proposeForMissed(_p: TrainingState, fd: FormData): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const id = z.uuid().safeParse(fd.get("workoutId"));
  if (!id.success) return { status: "error", message: "Session not found." };
  const [overdue, upcoming] = await Promise.all([
    overdueSessions(s.supabase, s.user.id, s.timezone, s.today),
    sessionsBetween(s.supabase, s.user.id, s.timezone, s.today, 10),
  ]);
  const missed = overdue.find((o) => o.id === id.data);
  if (!missed) return { status: "error", message: "That session is no longer overdue." };
  const p = missedSessionProposal(missed, upcoming, s.today);
  const { error } = await s.supabase.from("training_proposals").insert({
    user_id: s.user.id,
    kind: "missed_session",
    source_workout_id: missed.id,
    race_goal_id: missed.raceGoalId,
    title: p.title,
    summary: p.summary,
    reasons: p.reasons,
    changes: p.changes.map((c) => toStoredChange(c, s.timezone)),
  });
  if (error)
    return {
      status: "error",
      message: error.code === "23505" ? "There's already a proposal for that session." : dbMessage(error.code),
    };
  revalidatePath("/training");
  return { status: "success", message: "Proposal ready. Review it below." };
}

export async function checkAdaptive(): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const [past14, upcoming7, goal, fatigue] = await Promise.all([
    past14Stats(s.supabase, s.user.id, s.timezone, s.today),
    sessionsBetween(s.supabase, s.user.id, s.timezone, s.today, 7),
    activeGoal(s.supabase, s.user.id),
    recentFatigue(s.supabase, s.user.id, s.today),
  ]);
  const p = adaptiveProposal({ past14, upcoming7, fatigue });
  if (!p)
    return {
      status: "success",
      message:
        past14.planned === 0
          ? "No planned sessions in the last two weeks to learn from, so nothing to change."
          : `Continue as planned: you completed ${past14.completed} of ${past14.planned} sessions in the last two weeks${fatigue !== null ? ` and your fatigue averages ${fatigue.toFixed(1)} of 5` : ""}.`,
    };
  const { error } = await s.supabase.from("training_proposals").insert({
    user_id: s.user.id,
    kind: "adaptive",
    race_goal_id: goal?.id ?? null,
    title: p.title,
    summary: p.summary,
    reasons: p.reasons,
    changes: p.changes.map((c) => toStoredChange(c, s.timezone)),
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  return { status: "success", message: "An adjustment is proposed below." };
}

export async function decideProposal(_p: TrainingState, fd: FormData): Promise<TrainingState> {
  const s = await session();
  if ("error" in s) return { status: "error", message: s.error };
  const id = z.uuid().safeParse(fd.get("proposalId"));
  if (!id.success) return { status: "error", message: "Proposal not found." };
  const accept = fd.get("decision") === "accept";
  const total = Number(fd.get("total") ?? 0);
  const kept = new Set(fd.getAll("keep").map(Number));
  const skip = accept ? Array.from({ length: total }, (_, i) => i + 1).filter((i) => !kept.has(i)) : [];
  if (accept && kept.size === 0)
    return { status: "error", message: "Select at least one change, or reject the proposal." };
  const { data, error } = await s.supabase.rpc("decide_training_proposal", {
    p_id: id.data,
    p_accept: accept,
    p_skip: skip,
  });
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath("/training");
  revalidatePath("/schedule");
  return {
    status: "success",
    message: accept
      ? `Applied ${data} change${data === 1 ? "" : "s"} to your schedule.`
      : "Proposal rejected. Your schedule is unchanged.",
  };
}
