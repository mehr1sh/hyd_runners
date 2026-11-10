"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { parseClock } from "@/features/training/logic/pace";
import { defaultChecklist, RACE_DISTANCE_M, type ChecklistItem, type RaceDistance } from "./logic";

export type PassportState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}

function dbMessage(code?: string) {
  if (code === "23505") return "That race is already in your passport.";
  if (code === "23514") return "Check the details (phone numbers use digits, spaces and +).";
  if (code === "42501") return "That isn't yours to link.";
  if (code === "PT429") return "Too many changes. Please wait a little.";
  return "Something went wrong. Please try again.";
}

const NewEntry = z.object({
  name: z.string().trim().min(2, "Name the race.").max(120),
  raceDate: z.iso.date("Choose the race date."),
  distance: z.enum(["5k", "10k", "half", "marathon", "other"]),
  otherKm: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(1).max(250).nullable()),
  city: z.string().trim().max(80),
  eventId: z.uuid().optional(),
});

export async function addRace(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = NewEntry.safeParse({
    ...Object.fromEntries(fd),
    city: fd.get("city") ?? "",
    eventId: fd.get("eventId") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const e = parsed.data;
  if (e.distance === "other" && !e.otherKm) return { status: "error", message: "Give the distance in km." };
  const distanceM = e.distance === "other" ? Math.round(e.otherKm! * 1000) : RACE_DISTANCE_M[e.distance];
  const { data, error } = await s.supabase
    .from("race_entries")
    .insert({
      user_id: s.user.id,
      event_id: e.eventId ?? null,
      name: e.name,
      race_date: e.raceDate,
      distance: e.distance,
      distance_m: distanceM,
      city: e.city || null,
      status: e.eventId ? "registered" : "planned",
      checklist: defaultChecklist(e.distance as RaceDistance),
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: dbMessage(error.code) };
  redirect(`/passport/${data.id}`);
}

const Details = z.object({
  id: z.uuid(),
  status: z.enum(["planned", "registered", "completed", "dnf", "dns", "cancelled"]),
  target: z.string().trim().max(10),
  bib: z.string().trim().max(20),
  wave: z.string().trim().max(40),
  travelNotes: z.string().trim().max(1000),
  emergencyName: z.string().trim().max(80),
  emergencyPhone: z.string().trim().max(20),
  findPartners: z.boolean(),
});

export async function saveRaceDetails(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Details.safeParse({
    id: fd.get("id"),
    status: fd.get("status"),
    target: fd.get("target") ?? "",
    bib: fd.get("bib") ?? "",
    wave: fd.get("wave") ?? "",
    travelNotes: fd.get("travelNotes") ?? "",
    emergencyName: fd.get("emergencyName") ?? "",
    emergencyPhone: fd.get("emergencyPhone") ?? "",
    findPartners: fd.get("findPartners") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  let target: number | null = null;
  if (d.target) {
    target = parseClock(d.target);
    if (target === null || target < 600) return { status: "error", message: "Write the target as h:mm:ss or mm:ss." };
  }
  const { error } = await s.supabase
    .from("race_entries")
    .update({
      status: d.status,
      target_seconds: target,
      bib: d.bib || null,
      wave: d.wave || null,
      travel_notes: d.travelNotes || null,
      emergency_name: d.emergencyName || null,
      emergency_phone: d.emergencyPhone || null,
      find_partners: d.findPartners,
    })
    .eq("id", d.id)
    .eq("user_id", s.user.id);
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath(`/passport/${d.id}`);
  return { status: "success", message: "Saved." };
}

export async function toggleChecklist(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const { data } = await s.supabase
    .from("race_entries")
    .select("checklist")
    .eq("id", id.data)
    .eq("user_id", s.user.id)
    .maybeSingle();
  if (!data) return;
  let list = (data.checklist as ChecklistItem[]) ?? [];
  const item = String(fd.get("item") ?? "");
  const add = String(fd.get("add") ?? "")
    .trim()
    .slice(0, 120);
  if (fd.get("remove") && item) list = list.filter((i) => i.id !== item);
  else if (item) list = list.map((i) => (i.id === item ? { ...i, done: !i.done } : i));
  if (add && list.length < 40)
    list = [
      ...list,
      { id: `u${list.length}${Date.parse(new Date().toISOString()) % 100000}`, label: add, done: false },
    ];
  await s.supabase.from("race_entries").update({ checklist: list }).eq("id", id.data).eq("user_id", s.user.id);
  revalidatePath(`/passport/${id.data}`);
}

export async function recordResult(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { status: "error", message: "Race not found." };
  const activityId = fd.get("activityId");
  const time = String(fd.get("time") ?? "").trim();
  const reflection = String(fd.get("reflection") ?? "")
    .trim()
    .slice(0, 2000);
  let patch: Record<string, unknown>;
  if (activityId && z.uuid().safeParse(activityId).success) {
    patch = { result_activity_id: activityId, status: "completed" };
  } else if (time) {
    const secs = parseClock(time);
    if (secs === null || secs < 60) return { status: "error", message: "Write your time as h:mm:ss or mm:ss." };
    patch = { result_seconds: secs, result_source: "self_reported", result_activity_id: null, status: "completed" };
  } else patch = {};
  const { error } = await s.supabase
    .from("race_entries")
    .update({ ...patch, reflection: reflection || null })
    .eq("id", id.data)
    .eq("user_id", s.user.id);
  if (error) return { status: "error", message: dbMessage(error.code) };
  revalidatePath(`/passport/${id.data}`);
  revalidatePath("/passport");
  return { status: "success", message: "Result saved." };
}

export async function deleteRace(fd: FormData) {
  const s = await ctx();
  if ("error" in s) return;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  await s.supabase.from("race_entries").delete().eq("id", id.data).eq("user_id", s.user.id);
  revalidatePath("/passport");
  redirect("/passport");
}

export async function checkInByToken(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z.object({ eventId: z.uuid(), token: z.uuid() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "That isn't a HYD Runners check-in code." };
  const { data, error } = await s.supabase.rpc("check_in_by_token", {
    p_event: parsed.data.eventId,
    p_token: parsed.data.token,
  });
  if (error)
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this event's organisers, captains and sweepers can check runners in."
          : error.code === "P0002"
            ? "This code isn't for this event."
            : error.code === "22023"
              ? "Check-in opens two hours before the start."
              : "Couldn't check in. Try again.",
    };
  revalidatePath(`/events/${parsed.data.eventId}/manage`);
  return { status: "success", message: `Checked in: ${data as string}` };
}

const SponsorForm = z.object({
  eventId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().max(300),
  tier: z.enum(["title", "partner", "supporter"]),
});

export async function addSponsor(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = SponsorForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Give the sponsor a name." };
  const p = parsed.data;
  if (p.url && !/^https:\/\//.test(p.url))
    return { status: "error", message: "Sponsor links must start with https://" };
  const { error } = await s.supabase
    .from("event_sponsors")
    .insert({ event_id: p.eventId, name: p.name, url: p.url || null, tier: p.tier });
  if (error)
    return {
      status: "error",
      message: error.code === "42501" ? "Only organisers manage sponsors." : dbMessage(error.code),
    };
  revalidatePath(`/events/${p.eventId}`);
  revalidatePath(`/events/${p.eventId}/manage`);
  return { status: "success", message: "Sponsor added." };
}

/**
 * Bulk results: one line per runner, "user id, outcome, time" as exported by
 * the attendance CSV. Each line goes through the same rules as single results.
 */
export async function importResults(_p: PassportState, fd: FormData): Promise<PassportState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const eventId = z.uuid().safeParse(fd.get("eventId"));
  if (!eventId.success) return { status: "error", message: "Event not found." };
  const lines = String(fd.get("csv") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^user_id/i.test(l))
    .slice(0, 1000);
  let ok = 0;
  const problems: string[] = [];
  for (const [i, line] of lines.entries()) {
    const [userId, outcome, time] = line.split(",").map((x) => x.trim());
    const outcomeOk = ["finished", "dnf", "dns"].includes(outcome ?? "");
    const secs = time ? parseClock(time) : null;
    if (!z.uuid().safeParse(userId).success || !outcomeOk || (time && secs === null)) {
      problems.push(`line ${i + 1}`);
      continue;
    }
    const { error } = await s.supabase.from("event_results").upsert(
      {
        event_id: eventId.data,
        user_id: userId,
        outcome,
        finish_seconds: outcome === "finished" ? secs : null,
        recorded_by: s.user.id,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: "event_id,user_id" },
    );
    if (error) problems.push(`line ${i + 1}`);
    else ok++;
  }
  revalidatePath(`/events/${eventId.data}/manage`);
  return {
    status: problems.length && !ok ? "error" : "success",
    message: `Saved ${ok} result${ok === 1 ? "" : "s"}.${problems.length ? ` Skipped ${problems.slice(0, 8).join(", ")}${problems.length > 8 ? "…" : ""}.` : ""}`,
  };
}
