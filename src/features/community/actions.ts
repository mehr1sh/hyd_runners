"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { reconcileRewards } from "@/features/gamification/service";

export type RsvpState = { status: "idle" | "error" | "ok"; message?: string };

export async function rsvpAction(_prev: RsvpState, formData: FormData): Promise<RsvpState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const eventId = z.uuid().safeParse(formData.get("eventId"));
  const status = z.enum(["going", "cancelled"]).safeParse(formData.get("status"));
  if (!eventId.success || !status.success) return { status: "error", message: "Event not found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_rsvps")
    .upsert({ event_id: eventId.data, user_id: user.id, status: status.data }, { onConflict: "event_id,user_id" });
  if (error) {
    if (error.message.includes("full")) return { status: "error", message: "Sorry, this event is full." };
    if (error.message.includes("not open"))
      return { status: "error", message: "This event is no longer taking sign-ups." };
    console.error(error);
    return { status: "error", message: "Could not update your RSVP." };
  }
  if (status.data === "going") await reconcileRewards(user.id);
  revalidatePath("/events");
  revalidatePath("/map");
  revalidatePath("/dashboard");
  return { status: "ok", message: status.data === "going" ? "You're going!" : "RSVP cancelled." };
}

export async function setLeaderboardVisibilityAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const show = formData.get("show") === "true";
  const supabase = await createClient();
  await supabase
    .from("runner_settings")
    .upsert({ user_id: user.id, show_on_leaderboard: show }, { onConflict: "user_id" });
  revalidatePath("/community");
}
