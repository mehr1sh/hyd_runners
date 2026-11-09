"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LiveResult = { ok: boolean; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  return { user, supabase: await createClient() };
}

function message(code?: string, fallback = "Something went wrong. Please try again.") {
  if (code === "42501") return "Only participants and the run's team can do that.";
  if (code === "22023") return "The live session opens an hour before the start and closes at the end.";
  if (code === "P0002") return "The live session isn't running.";
  if (code === "PT429") return "Too many requests. Please wait a moment.";
  return fallback;
}

const id = z.uuid();

async function sessionFor(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string) {
  const { data } = await supabase.from("live_sessions").select("id").eq("event_id", eventId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function startLiveSession(eventId: string): Promise<LiveResult> {
  const c = await ctx();
  if (!c || !id.safeParse(eventId).success) return { ok: false, message: "Sign in to continue." };
  const { error } = await c.supabase.rpc("start_live_session", { p_event: eventId });
  return error ? { ok: false, message: message(error.code) } : { ok: true };
}

export async function endLiveSession(eventId: string): Promise<LiveResult> {
  const c = await ctx();
  if (!c || !id.safeParse(eventId).success) return { ok: false, message: "Sign in to continue." };
  const sid = await sessionFor(c.supabase, eventId);
  if (!sid) return { ok: false, message: "No live session." };
  const { error } = await c.supabase.rpc("end_live_session", { p_session: sid });
  return error ? { ok: false, message: message(error.code) } : { ok: true };
}

export async function startSharing(eventId: string, minutes: number): Promise<LiveResult & { until?: string }> {
  const c = await ctx();
  if (!c || !id.safeParse(eventId).success) return { ok: false, message: "Sign in to continue." };
  const sid = await sessionFor(c.supabase, eventId);
  if (!sid) return { ok: false, message: "The live session hasn't started yet." };
  const m = [30, 60, 90, 120, 180].includes(minutes) ? minutes : 60;
  const { data, error } = await c.supabase.rpc("start_location_sharing", { p_session: sid, p_minutes: m });
  return error ? { ok: false, message: message(error.code) } : { ok: true, until: data as string };
}

export async function stopSharing(eventId: string): Promise<LiveResult> {
  const c = await ctx();
  if (!c || !id.safeParse(eventId).success) return { ok: false, message: "Sign in to continue." };
  const sid = await sessionFor(c.supabase, eventId);
  if (!sid) return { ok: true };
  const { error } = await c.supabase.rpc("stop_location_sharing", { p_session: sid });
  return error ? { ok: false, message: message(error.code) } : { ok: true };
}

export async function requestHelp(
  eventId: string,
  note: string,
  lat: number | null,
  lon: number | null,
): Promise<LiveResult> {
  const c = await ctx();
  if (!c || !id.safeParse(eventId).success) return { ok: false, message: "Sign in to continue." };
  const sid = await sessionFor(c.supabase, eventId);
  if (!sid) return { ok: false, message: "The live session isn't running. Call the organiser directly." };
  const { error } = await c.supabase.rpc("request_live_help", {
    p_session: sid,
    p_note: note.slice(0, 300),
    p_lat: lat,
    p_lon: lon,
  });
  return error
    ? { ok: false, message: message(error.code) }
    : { ok: true, message: "The run's team has been notified." };
}

export async function resolveHelp(requestId: string): Promise<LiveResult> {
  const c = await ctx();
  if (!c || !id.safeParse(requestId).success) return { ok: false };
  const { error } = await c.supabase.rpc("resolve_live_help", { p_request: requestId });
  return error ? { ok: false, message: message(error.code) } : { ok: true };
}
