"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { reconcileRewards } from "@/features/gamification/service";
import { assertGrantableRole } from "./logic/access";
import {
  parseAnnouncementForm,
  parseEventForm,
  parseLocationForm,
  parseLocationUpdateForm,
  parseMessageForm,
} from "./logic/content";
import { parseFeedbackForm, parseReplyForm } from "./logic/feedback";
import {
  assignCoach,
  grantStaffRole,
  markAnnouncementRead,
  removeAssignment,
  replyToFeedback,
  revokeStaffRole,
  saveAnnouncement,
  saveEvent,
  saveLocation,
  saveLocationUpdate,
  sendMessage,
  submitFeedback,
  updateFeedback,
} from "./service";

export type FormState = { status: "idle" | "error" | "success"; message?: string };

type Session =
  | {
      ok: true;
      user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; message: string };

async function session(): Promise<Session> {
  if (!isSupabaseConfigured) return { ok: false, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Sign in to continue." };
  return { ok: true, user, supabase: await createClient() };
}

function done(result: { ok: boolean; message?: string }, success: string, paths: string[]): FormState {
  if (!result.ok) return { status: "error", message: result.message };
  for (const path of paths) revalidatePath(path);
  return { status: "success", message: success };
}

const COMMUNITY_PATHS = ["/community", "/coach", "/manager", "/events", "/map"];

export async function submitFeedbackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseFeedbackForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const saved = await submitFeedback(current.supabase, current.user.id, parsed.data);
  return done(saved, "Feedback submitted.", COMMUNITY_PATHS);
}

export async function replyToFeedbackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseReplyForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const saved = await replyToFeedback(current.supabase, current.user.id, parsed.data.feedbackId, parsed.data.body);
  return done(saved, "Reply sent.", COMMUNITY_PATHS);
}

export async function updateFeedbackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const feedbackId = String(formData.get("feedbackId") ?? "");
  const assignedTo = String(formData.get("assignedTo") ?? "");
  const status = String(formData.get("status") ?? "");
  const saved = await updateFeedback(current.supabase, current.user.id, feedbackId, {
    assignedTo: assignedTo || undefined,
    status: status === "new" || status === "acknowledged" || status === "resolved" ? status : undefined,
  });
  return done(saved, "Feedback updated.", COMMUNITY_PATHS);
}

export async function saveAnnouncementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseAnnouncementForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const id = String(formData.get("id") ?? "");
  const saved = await saveAnnouncement(current.supabase, current.user.id, { ...parsed.data, id: id || undefined });
  return done(saved, id ? "Announcement updated." : "Announcement published.", ["/community", "/manager"]);
}

export async function markAnnouncementReadAction(formData: FormData) {
  const current = await session();
  if (!current.ok) return;
  const id = String(formData.get("announcementId") ?? "");
  if (!id) return;
  await markAnnouncementRead(current.supabase, current.user.id, id);
  revalidatePath("/community");
}

export async function saveEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseEventForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const id = String(formData.get("id") ?? "");
  const saved = await saveEvent(current.supabase, current.user.id, { ...parsed.data, id: id || undefined });
  return done(saved, id ? "Event updated." : "Event saved.", ["/events", "/manager"]);
}

export async function saveLocationUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseLocationUpdateForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const id = String(formData.get("id") ?? "");
  const saved = await saveLocationUpdate(current.supabase, current.user.id, { ...parsed.data, id: id || undefined });
  return done(saved, id ? "Location update saved." : "Location update published.", ["/map", "/manager"]);
}

export async function saveLocationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseLocationForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const id = String(formData.get("id") ?? "");
  const saved = await saveLocation(current.supabase, current.user.id, { ...parsed.data, id: id || undefined });
  return done(saved, "Location saved.", ["/map", "/manager", "/onboarding"]);
}

export async function sendMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseMessageForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const saved = await sendMessage(current.supabase, current.user.id, parsed.data.recipientId, parsed.data.body);
  return done(saved, "Message sent. It stays in the app — nothing is emailed.", COMMUNITY_PATHS);
}

export async function grantRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const role = String(formData.get("role") ?? "");
  const targetId = String(formData.get("userId") ?? "");
  if (!assertGrantableRole(role)) return { status: "error", message: "You can only grant coach or mentor." };
  const saved = await grantStaffRole(current.supabase, current.user.id, targetId, role);
  return done(saved, "Role granted.", ["/manager", "/coach"]);
}

export async function revokeRoleAction(formData: FormData) {
  const current = await session();
  if (!current.ok) return;
  const role = String(formData.get("role") ?? "");
  const targetId = String(formData.get("userId") ?? "");
  if (!assertGrantableRole(role)) return;
  await revokeStaffRole(current.supabase, current.user.id, targetId, role);
  revalidatePath("/manager");
}

export async function assignCoachAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const saved = await assignCoach(
    current.supabase,
    current.user.id,
    String(formData.get("coachId") ?? ""),
    String(formData.get("runnerId") ?? ""),
  );
  return done(saved, "Coach assigned.", ["/manager", "/coach"]);
}

export async function removeAssignmentAction(formData: FormData) {
  const current = await session();
  if (!current.ok) return;
  await removeAssignment(current.supabase, current.user.id, String(formData.get("assignmentId") ?? ""));
  revalidatePath("/manager");
}

// ---------------------------------------------------------------------------
// Runner experience: event RSVPs and leaderboard visibility
// ---------------------------------------------------------------------------

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
