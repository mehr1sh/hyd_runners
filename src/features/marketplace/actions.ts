"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_KINDS, type ServiceKind } from "./logic";

export type MarketState = { status: "idle" | "error" | "success"; message?: string };

async function ctx() {
  if (!isSupabaseConfigured) return { error: "Unavailable in preview mode." } as const;
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to continue." } as const;
  return { user, supabase: await createClient() } as const;
}

function dbMessage(code?: string, message?: string) {
  if (code === "P0002")
    return message?.includes("free") ? "That time is no longer free." : "That isn't available any more.";
  if (code === "22023")
    return message ? message.charAt(0).toUpperCase() + message.slice(1) + "." : "Check the details.";
  if (code === "42501")
    return message?.includes("verified") ? "Your profile must be verified first." : "That isn't possible.";
  if (code === "PT429") return "Too many requests today. Please try again tomorrow.";
  return "Something went wrong. Please try again.";
}

const Service = z.object({
  kind: z.enum(Object.keys(SERVICE_KINDS) as [ServiceKind, ...ServiceKind[]]),
  title: z.string().trim().min(3, "Name the service.").max(100),
  description: z.string().trim().max(1000),
  duration: z.coerce.number().int().min(15).max(240),
  delivery: z.enum(["in_person", "online"]),
  price: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(0).max(100000).nullable(),
  ),
});

export async function addService(_p: MarketState, fd: FormData): Promise<MarketState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = Service.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { error } = await s.supabase.from("professional_services").insert({
    professional_id: s.user.id,
    kind: v.kind,
    title: v.title,
    description: v.description || null,
    duration_minutes: v.duration,
    delivery: v.delivery,
    indicative_price_inr: v.price,
  });
  if (error)
    return {
      status: "error",
      message:
        error.code === "23503" ? "Create your professional profile first." : dbMessage(error.code, error.message),
    };
  revalidatePath("/coach/services");
  return {
    status: "success",
    message: "Service added. It's listed once your profile is verified and shown to runners.",
  };
}

export async function addSlot(_p: MarketState, fd: FormData): Promise<MarketState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      date: z.iso.date(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      minutes: z.coerce.number().int().min(15).max(240),
      where: z.string().trim().max(120),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { status: "error", message: "Choose a date, time and length." };
  const starts = new Date(`${parsed.data.date}T${parsed.data.time}:00+05:30`);
  const { error } = await s.supabase.from("professional_slots").insert({
    professional_id: s.user.id,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + parsed.data.minutes * 60_000).toISOString(),
    location_note: parsed.data.where || null,
  });
  if (error)
    return {
      status: "error",
      message:
        error.code === "23503" ? "Create your professional profile first." : dbMessage(error.code, error.message),
    };
  revalidatePath("/coach/services");
  return { status: "success", message: "Time added." };
}

export async function requestBooking(_p: MarketState, fd: FormData): Promise<MarketState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      serviceId: z.uuid("Choose a service."),
      slotId: z.uuid("Choose a time."),
      note: z.string().trim().max(500),
      acknowledged: z.boolean(),
    })
    .safeParse({
      serviceId: fd.get("serviceId"),
      slotId: fd.get("slotId"),
      note: fd.get("note") ?? "",
      acknowledged: fd.get("acknowledged") === "on",
    });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const b = parsed.data;
  const { error } = await s.supabase.rpc("request_booking", {
    p_service: b.serviceId,
    p_slot: b.slotId,
    p_note: b.note,
    p_acknowledged: b.acknowledged,
  });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath("/bookings");
  return { status: "success", message: "Request sent. You'll be notified when it's confirmed." };
}

export async function updateBooking(_p: MarketState, fd: FormData): Promise<MarketState> {
  const s = await ctx();
  if ("error" in s) return { status: "error", message: s.error };
  const parsed = z
    .object({
      id: z.uuid(),
      action: z.enum(["confirm", "decline", "cancel", "complete"]),
      note: z.string().trim().max(500),
    })
    .safeParse({ id: fd.get("id"), action: fd.get("action"), note: fd.get("note") ?? "" });
  if (!parsed.success) return { status: "error", message: "Check the form." };
  const { error } = await s.supabase.rpc("update_booking", {
    p_booking: parsed.data.id,
    p_action: parsed.data.action,
    p_note: parsed.data.note,
  });
  if (error) return { status: "error", message: dbMessage(error.code, error.message) };
  revalidatePath("/bookings");
  revalidatePath("/coach/services");
  return { status: "success", message: "Updated." };
}
