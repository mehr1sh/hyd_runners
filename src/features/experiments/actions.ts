"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { JOURNEYS, type JourneyKey } from "./logic";

export type ExpState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}
const msg = (code?: string) =>
  code === "42501"
    ? "Only organisers can do that."
    : code === "23505"
      ? "That's already set up."
      : code === "P0002"
        ? "Nothing to review."
        : "Something went wrong. Please try again.";

export async function startRelay(_p: ExpState, fd: FormData): Promise<ExpState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      squadId: z.uuid(),
      journey: z.enum(Object.keys(JOURNEYS) as [JourneyKey, ...JourneyKey[]]),
      startsOn: z.iso.date(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Choose a journey and start date." };
  const { error } = await s.supabase
    .from("squad_relays")
    .insert({ squad_id: parsed.data.squadId, journey: parsed.data.journey, starts_on: parsed.data.startsOn });
  if (error)
    return { status: "error", message: error.code === "42501" ? "Only captains start relays." : msg(error.code) };
  revalidatePath(`/squads/${parsed.data.squadId}`);
  return { status: "success", message: "Relay started." };
}

export async function setMystery(_p: ExpState, fd: FormData): Promise<ExpState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      eventId: z.uuid(),
      routeId: z.union([z.uuid(), z.literal("")]),
      revealDate: z.string(),
      revealTime: z.string(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Check the form." };
  const p = parsed.data;
  const reveal = p.routeId ? new Date(`${p.revealDate}T${p.revealTime || "05:00"}:00+05:30`) : null;
  if (p.routeId && (!reveal || Number.isNaN(reveal.getTime())))
    return { status: "error", message: "Choose when the route is revealed." };
  const { error } = await s.supabase.rpc("set_mystery_run", {
    p_event: p.eventId,
    p_route: p.routeId || null,
    p_reveal_at: reveal?.toISOString() ?? null,
  });
  if (error) return { status: "error", message: msg(error.code) };
  revalidatePath(`/events/${p.eventId}`);
  revalidatePath(`/events/${p.eventId}/manage`);
  return { status: "success", message: p.routeId ? "Mystery route set." : "Mystery route removed." };
}

export async function setCause(_p: ExpState, fd: FormData): Promise<ExpState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({ challengeId: z.uuid(), name: z.string().trim().max(120), url: z.string().trim().max(300) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Check the form." };
  if (parsed.data.url && !/^https:\/\//.test(parsed.data.url))
    return { status: "error", message: "Links must start with https://" };
  const { error } = await s.supabase.rpc("set_challenge_cause", {
    p_challenge: parsed.data.challengeId,
    p_name: parsed.data.name,
    p_url: parsed.data.url,
  });
  if (error)
    return {
      status: "error",
      message: error.code === "42501" ? "Only the challenge's organisers can add a cause." : msg(error.code),
    };
  revalidatePath(`/challenges/${parsed.data.challengeId}`);
  return {
    status: "success",
    message: parsed.data.name ? "Cause added. It shows as unverified until an admin checks it." : "Cause removed.",
  };
}

export async function verifyCause(_p: ExpState, fd: FormData): Promise<ExpState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const id = z.uuid().safeParse(fd.get("challengeId"));
  if (!id.success) return { status: "error", message: "Challenge not found." };
  const { error } = await s.supabase.rpc("verify_challenge_cause", {
    p_challenge: id.data,
    p_verified: fd.get("decision") === "verify",
  });
  if (error) return { status: "error", message: error.code === "42501" ? "Admins only." : msg(error.code) };
  revalidatePath(`/challenges/${id.data}`);
  return { status: "success", message: "Saved." };
}
