"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { localMidnightUtc, addDays } from "@/features/gamification/logic/time";
import { parseChallengeForm } from "./logic";

export type ChallengeFormState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Sign in to continue." };
  return { ok: true as const, user, supabase: await createClient() };
}

function refresh(id?: string) {
  revalidatePath("/challenges");
  if (id) revalidatePath(`/challenges/${id}`);
  revalidatePath("/dashboard");
}

export async function joinChallengeAction(_prev: ChallengeFormState, formData: FormData): Promise<ChallengeFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const id = z.uuid().safeParse(formData.get("challengeId"));
  if (!id.success) return { status: "error", message: "Challenge not found." };
  const join = formData.get("intent") !== "leave";
  const { error } = join
    ? await current.supabase.from("challenge_participants").insert({ challenge_id: id.data, user_id: current.user.id })
    : await current.supabase
        .from("challenge_participants")
        .delete()
        .eq("challenge_id", id.data)
        .eq("user_id", current.user.id);
  if (error) {
    const message =
      error.code === "23505"
        ? "You've already joined."
        : error.code === "42501"
          ? "This challenge isn't open to you right now."
          : "Could not update your challenge.";
    if (message === "Could not update your challenge.") console.error("[challenges] join failed", error.code);
    return { status: "error", message };
  }
  // Counts anything already done in the window, and pays out if that completes it.
  if (join) await current.supabase.rpc("settle_my_challenges");
  refresh(id.data);
  return {
    status: "success",
    message: join ? "You're in! Activities already in the window count." : "You left the challenge.",
  };
}

export async function createChallengeAction(
  _prev: ChallengeFormState,
  formData: FormData,
): Promise<ChallengeFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseChallengeForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const c = parsed.data;
  const tz = "Asia/Kolkata";
  const { data, error } = await current.supabase
    .from("challenges")
    .insert({
      title: c.title,
      description: c.description,
      scope: c.clubId ? "club" : "city",
      club_id: c.clubId,
      kind: c.kind,
      goal: c.goal,
      collective: c.collective,
      starts_at: localMidnightUtc(c.startsOn, tz).toISOString(),
      ends_at: localMidnightUtc(addDays(c.endsOn, 1), tz).toISOString(),
      timezone: tz,
      reward_xp: c.rewardXp,
      created_by: current.user.id,
    })
    .select("id")
    .single();
  if (error) {
    const message =
      error.code === "42501"
        ? c.clubId
          ? "Only this club's admins can create its challenges."
          : "Only programme managers create city-wide challenges."
        : error.code === "23514"
          ? "Check the dates (at most a year) and goal."
          : "Could not create the challenge.";
    if (message === "Could not create the challenge.") console.error("[challenges] create failed", error.code);
    return { status: "error", message };
  }
  refresh();
  redirect(`/challenges/${data.id}`);
}

export async function cancelChallengeAction(
  _prev: ChallengeFormState,
  formData: FormData,
): Promise<ChallengeFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const id = z.uuid().safeParse(formData.get("challengeId"));
  if (!id.success) return { status: "error", message: "Challenge not found." };
  const { error, count } = await current.supabase
    .from("challenges")
    .update({ status: "cancelled" }, { count: "exact" })
    .eq("id", id.data);
  if (error) {
    console.error("[challenges] cancel failed", error.code);
    return { status: "error", message: "Could not cancel the challenge." };
  }
  if (count === 0) return { status: "error", message: "You can't change this challenge." };
  refresh(id.data);
  return { status: "success", message: "Challenge cancelled. Rewards already earned are kept." };
}
