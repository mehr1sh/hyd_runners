"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type StoryState = { status: "idle" | "error" | "success"; message?: string };

const t = (n: number) => z.string().trim().max(n);

export async function saveReflection(_p: StoryState, fd: FormData): Promise<StoryState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const parsed = z
    .object({
      activityId: z.uuid(),
      difficult: t(300),
      enjoyed: t(300),
      ranWith: t(120),
      achieved: t(300),
      story: t(1500),
      share: z.boolean(),
    })
    .safeParse({
      activityId: fd.get("activityId"),
      difficult: fd.get("difficult") ?? "",
      enjoyed: fd.get("enjoyed") ?? "",
      ranWith: fd.get("ranWith") ?? "",
      achieved: fd.get("achieved") ?? "",
      story: fd.get("story") ?? "",
      share: fd.get("share") === "on",
    });
  if (!parsed.success) return { status: "error", message: "Keep each answer short." };
  const r = parsed.data;
  const supabase = await createClient();
  const values = {
    difficult: r.difficult || null,
    enjoyed: r.enjoyed || null,
    ran_with: r.ranWith || null,
    achieved: r.achieved || null,
    story: r.story || null,
    share_story: r.share,
  };
  // Insert or update (runners can't update the key columns an upsert would set).
  const { data: existing } = await supabase
    .from("activity_reflections")
    .select("activity_id")
    .eq("activity_id", r.activityId)
    .eq("user_id", user.id)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("activity_reflections").update(values).eq("activity_id", r.activityId).eq("user_id", user.id)
    : await supabase.from("activity_reflections").insert({ activity_id: r.activityId, user_id: user.id, ...values });
  if (error)
    return {
      status: "error",
      message: error.code === "42501" ? "That isn't your activity." : "Couldn't save. Try again.",
    };
  revalidatePath(`/activities/${r.activityId}`);
  return {
    status: "success",
    message: r.share ? "Saved. Your story shows to people who can see this activity." : "Saved privately.",
  };
}

export async function saveProfileStyle(_p: StoryState, fd: FormData): Promise<StoryState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const parsed = z
    .object({
      theme: z.enum(["classic", "night", "sunrise", "lake"]),
      badges: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(6, "Pick up to six badges."),
      routes: z.array(z.uuid()).max(5, "Pick up to five routes."),
      races: z.boolean(),
    })
    .safeParse({
      theme: fd.get("theme"),
      badges: fd.getAll("badges"),
      routes: fd.getAll("routes"),
      races: fd.get("races") === "on",
    });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      profile_theme: p.theme,
      showcase_badges: p.badges,
      favourite_route_ids: p.routes,
      show_race_history: p.races,
    })
    .eq("id", user.id);
  if (error) return { status: "error", message: "Couldn't save. Try again." };
  revalidatePath("/profile");
  revalidatePath(`/runners/${user.id}`);
  return { status: "success", message: "Profile style saved." };
}
