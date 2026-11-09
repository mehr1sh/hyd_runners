"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { dbFailure } from "@/features/shared/db";
import type { PostgrestError } from "@supabase/supabase-js";

function failMsg(error: PostgrestError, fallback: string) {
  const failed = dbFailure(error, fallback);
  return failed.ok ? fallback : failed.message;
}
import { parsePaceGroupForm, parseResultForm } from "./logic";

export type EventFormState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Sign in to continue." };
  return { ok: true as const, user, supabase: await createClient() };
}

function refresh(eventId: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/manage`);
  revalidatePath("/events");
}

const id = z.uuid();

/** Runs a write that RLS may silently filter: zero rows means "not allowed". */
function noRows(count: number | null): EventFormState | null {
  return count === 0 ? { status: "error", message: "You can't change that event." } : null;
}

export async function choosePaceGroupAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = id.safeParse(formData.get("eventId"));
  const raw = String(formData.get("paceGroupId") ?? "");
  const paceGroupId = raw === "" ? null : id.safeParse(raw);
  if (!eventId.success || (paceGroupId !== null && !paceGroupId.success)) {
    return { status: "error", message: "Choose a pace group." };
  }
  const { error, count } = await current.supabase
    .from("event_rsvps")
    .update({ pace_group_id: paceGroupId?.data ?? null }, { count: "exact" })
    .eq("event_id", eventId.data)
    .eq("user_id", current.user.id);
  if (error) return { status: "error", message: failMsg(error, "Could not save your pace group.") };
  const denied = noRows(count);
  if (denied) return { status: "error", message: "RSVP first, then choose a pace group." };
  refresh(eventId.data);
  return { status: "success", message: "Pace group saved." };
}

export async function checkInAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = id.safeParse(formData.get("eventId"));
  const userId = id.safeParse(formData.get("userId"));
  if (!eventId.success || !userId.success) return { status: "error", message: "Person not found." };
  const present = formData.get("present") === "true";
  const { error } = await current.supabase.rpc("check_in_attendee", {
    p_event_id: eventId.data,
    p_user_id: userId.data,
    p_present: present,
  });
  if (error) {
    const message =
      error.code === "22023"
        ? "Check-in opens two hours before the start and closes a day after the end."
        : error.code === "P0002"
          ? "That person doesn't have a place."
          : failMsg(error, "Could not update check-in.");
    return { status: "error", message };
  }
  refresh(eventId.data);
  return { status: "success", message: present ? "Checked in." : "Check-in removed." };
}

export async function postEventUpdateAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = id.safeParse(formData.get("eventId"));
  const body = z.string().trim().min(1, "Write the update.").max(2000).safeParse(formData.get("body"));
  if (!eventId.success) return { status: "error", message: "Event not found." };
  if (!body.success) return { status: "error", message: body.error.issues[0]?.message };
  const { error } = await current.supabase
    .from("event_updates")
    .insert({ event_id: eventId.data, author_id: current.user.id, body: body.data });
  if (error) return { status: "error", message: failMsg(error, "Could not post that update.") };
  refresh(eventId.data);
  return { status: "success", message: "Update posted." };
}

export async function savePaceGroupAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parsePaceGroupForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const g = parsed.data;
  const { error } = await current.supabase.from("event_pace_groups").insert({
    event_id: g.eventId,
    label: g.label,
    min_pace_seconds: g.minPace,
    max_pace_seconds: g.maxPace,
    run_walk: g.runWalk,
    notes: g.notes,
  });
  if (error) {
    const message =
      error.code === "23505"
        ? "There is already a pace group with that name."
        : failMsg(error, "Could not add the pace group.");
    return { status: "error", message };
  }
  refresh(g.eventId);
  return { status: "success", message: "Pace group added." };
}

export async function setPaceGroupLeaderAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = String(formData.get("eventId") ?? "");
  const paceGroupId = String(formData.get("paceGroupId") ?? "");
  const leader = String(formData.get("leaderId") ?? "");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(eventId) || !uuid.test(paceGroupId) || (leader && !uuid.test(leader)))
    return { status: "error", message: "Check the form." };
  const { error, data } = await current.supabase
    .from("event_pace_groups")
    .update({ leader_id: leader || null })
    .eq("id", paceGroupId)
    .eq("event_id", eventId)
    .select("id");
  if (error || !data?.length)
    return {
      status: "error",
      message: error?.code === "22023" ? "Leaders must be on the event team." : "Could not update the leader.",
    };
  refresh(eventId);
  return { status: "success", message: leader ? "Leader assigned." : "Leader removed." };
}

export async function deletePaceGroupAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = id.safeParse(formData.get("eventId"));
  const groupId = id.safeParse(formData.get("paceGroupId"));
  if (!eventId.success || !groupId.success) return { status: "error", message: "Pace group not found." };
  const { error, count } = await current.supabase
    .from("event_pace_groups")
    .delete({ count: "exact" })
    .eq("id", groupId.data)
    .eq("event_id", eventId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not remove the pace group.") };
  const denied = noRows(count);
  if (denied) return denied;
  refresh(eventId.data);
  return { status: "success", message: "Pace group removed." };
}

export async function recordResultAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseResultForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const r = parsed.data;
  const { error } = await current.supabase.from("event_results").upsert(
    {
      event_id: r.eventId,
      user_id: r.userId,
      outcome: r.outcome,
      finish_seconds: r.finishSeconds,
      recorded_by: current.user.id,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "event_id,user_id" },
  );
  if (error) return { status: "error", message: failMsg(error, "Could not save the result.") };
  refresh(r.eventId);
  return { status: "success", message: "Result saved." };
}

const TeamDraft = z.object({
  eventId: z.uuid(),
  userId: z.uuid("Choose a person."),
  role: z.enum(["organiser", "captain", "sweeper"], "Choose a role."),
});

export async function addTeamMemberAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = TeamDraft.safeParse({
    eventId: formData.get("eventId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const { error } = await current.supabase.from("event_team").insert({
    event_id: parsed.data.eventId,
    user_id: parsed.data.userId,
    role: parsed.data.role,
    added_by: current.user.id,
  });
  if (error) {
    const message =
      error.code === "23505"
        ? "That person is already on the team."
        : error.code === "42501"
          ? "Only managers can add organisers. Organisers can add captains and sweepers."
          : failMsg(error, "Could not add them to the team.");
    return { status: "error", message };
  }
  refresh(parsed.data.eventId);
  return { status: "success", message: "Added to the team." };
}

export async function removeTeamMemberAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const eventId = id.safeParse(formData.get("eventId"));
  const userId = id.safeParse(formData.get("userId"));
  if (!eventId.success || !userId.success) return { status: "error", message: "Person not found." };
  const { error, count } = await current.supabase
    .from("event_team")
    .delete({ count: "exact" })
    .eq("event_id", eventId.data)
    .eq("user_id", userId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not update the team.") };
  const denied = noRows(count);
  if (denied) return denied;
  refresh(eventId.data);
  return { status: "success", message: "Removed from the team." };
}
