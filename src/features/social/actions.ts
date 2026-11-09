"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SocialState = { status: "idle" | "error" | "success"; message?: string };

const REASONS = ["harassment", "spam", "inappropriate", "safety", "other"] as const;

const Intent = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("follow"), userId: z.uuid() }),
  z.object({ intent: z.literal("unfollow"), userId: z.uuid() }),
  z.object({ intent: z.literal("accept"), userId: z.uuid() }),
  z.object({ intent: z.literal("remove_follower"), userId: z.uuid() }),
  z.object({ intent: z.literal("block"), userId: z.uuid() }),
  z.object({ intent: z.literal("unblock"), userId: z.uuid() }),
  z.object({ intent: z.literal("kudos"), activityId: z.uuid() }),
  z.object({ intent: z.literal("unkudos"), activityId: z.uuid() }),
  z.object({
    intent: z.literal("comment"),
    activityId: z.uuid(),
    body: z.string().trim().min(1, "Write a comment first.").max(500, "Comments can be up to 500 characters."),
  }),
  z.object({ intent: z.literal("delete_comment"), commentId: z.uuid(), activityId: z.uuid() }),
  z.object({
    intent: z.literal("report"),
    targetType: z.enum(["activity", "activity_comment"]),
    targetId: z.uuid(),
    activityId: z.uuid(),
    reason: z.enum(REASONS),
    details: z.string().trim().max(1000).optional(),
  }),
  z.object({
    intent: z.literal("settings"),
    bio: z.string().trim().max(160, "Bios can be up to 160 characters."),
    approveFollowers: z.boolean(),
    discoverable: z.boolean(),
  }),
]);

const MESSAGES: Record<string, string> = {
  follow: "Follow request sent.",
  unfollow: "You no longer follow this runner.",
  accept: "Follower accepted.",
  remove_follower: "Follower removed.",
  block: "Runner blocked. They can no longer see your activities or find you.",
  unblock: "Runner unblocked.",
  kudos: "Kudos given.",
  unkudos: "Kudos removed.",
  comment: "Comment posted.",
  delete_comment: "Comment deleted.",
  report: "Thanks. A moderator will review it.",
  settings: "Settings saved.",
};

function errorMessage(code: string | undefined, intent: string) {
  if (code === "PT429") return "You're doing that a lot. Please wait a little and try again.";
  if (code === "23505") return intent === "report" ? "You've already reported this." : "Already done.";
  if (code === "42501") return "That isn't possible for this runner or activity.";
  return null;
}

export async function socialAction(_prev: SocialState, formData: FormData): Promise<SocialState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const parsed = Intent.safeParse({
    ...Object.fromEntries(formData),
    approveFollowers: formData.get("approveFollowers") === "on",
    discoverable: formData.get("discoverable") === "on",
    details: formData.get("details") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  if ("userId" in d && d.userId === user.id) return { status: "error", message: "That's you." };
  const supabase = await createClient();
  const me = user.id;

  let res: { error: { code?: string } | null };
  let message = MESSAGES[d.intent];
  switch (d.intent) {
    case "follow": {
      res = await supabase.from("follows").insert({ follower_id: me, followee_id: d.userId });
      if (!res.error) {
        const { data } = await supabase
          .from("follows")
          .select("status")
          .eq("follower_id", me)
          .eq("followee_id", d.userId)
          .maybeSingle();
        if (data?.status === "accepted") message = "You're following this runner.";
      }
      break;
    }
    case "unfollow":
      res = await supabase.from("follows").delete().eq("follower_id", me).eq("followee_id", d.userId);
      break;
    case "accept":
      res = await supabase
        .from("follows")
        .update({ status: "accepted" })
        .eq("follower_id", d.userId)
        .eq("followee_id", me)
        .eq("status", "pending");
      break;
    case "remove_follower":
      res = await supabase.from("follows").delete().eq("follower_id", d.userId).eq("followee_id", me);
      break;
    case "block":
      res = await supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: d.userId });
      break;
    case "unblock":
      res = await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", d.userId);
      break;
    case "kudos":
      res = await supabase.from("activity_reactions").insert({ activity_id: d.activityId, user_id: me });
      break;
    case "unkudos":
      res = await supabase.from("activity_reactions").delete().eq("activity_id", d.activityId).eq("user_id", me);
      break;
    case "comment":
      res = await supabase.from("activity_comments").insert({ activity_id: d.activityId, author_id: me, body: d.body });
      break;
    case "delete_comment":
      res = await supabase.from("activity_comments").delete().eq("id", d.commentId);
      break;
    case "report":
      res = await supabase.rpc("report_content", {
        p_target_type: d.targetType,
        p_target_id: d.targetId,
        p_reason: d.reason,
        p_details: d.details ?? null,
      });
      break;
    case "settings":
      res = await supabase
        .from("profiles")
        .update({ bio: d.bio || null, approve_followers: d.approveFollowers, discoverable: d.discoverable })
        .eq("id", me);
      break;
  }
  if (res.error) {
    const known = errorMessage(res.error.code, d.intent);
    if (!known) console.error(`[social] ${d.intent} failed`, res.error.code);
    return { status: "error", message: known ?? "Something went wrong. Please try again." };
  }
  revalidatePath("/feed");
  revalidatePath("/runners", "layout");
  if ("activityId" in d) revalidatePath(`/activities/${d.activityId}`);
  return { status: "success", message };
}
