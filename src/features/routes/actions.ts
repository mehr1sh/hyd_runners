"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { dbFailure } from "@/features/shared/db";
import { slugify } from "@/features/clubs/logic";
import { elevationStats, parseAttributes, parseGpx, toWkt } from "./logic";

export type RouteFormState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Sign in to continue." };
  return { ok: true as const, user, supabase: await createClient() };
}

function failMsg(error: PostgrestError, fallback: string) {
  // Pass on only the messages our own database rules raise for people.
  if (/^(Routes must|A route needs|Only programme managers publish|A route's author)/.test(error.message)) {
    return error.message;
  }
  if (error.code === "42501") return "You can't do that with your account.";
  if (error.code === "23505") return "A route with that name already exists. Choose another name.";
  if (error.code === "PT429") return "You've sent a lot of reports today. Please try again tomorrow.";
  const failed = dbFailure(error, fallback);
  return failed.ok ? fallback : failed.message;
}

const MAX_GPX_BYTES = 2.5 * 1024 * 1024;

export async function uploadGpxRouteAction(_prev: RouteFormState, formData: FormData): Promise<RouteFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const name = z.string().trim().min(3, "Name the route.").max(120).safeParse(formData.get("name"));
  const description = z
    .string()
    .trim()
    .max(3000)
    .safeParse(formData.get("description") ?? "");
  const area =
    String(formData.get("area") ?? "")
      .trim()
      .slice(0, 80) || null;
  const file = formData.get("gpx");
  if (!name.success) return { status: "error", message: name.error.issues[0]?.message };
  if (!description.success) return { status: "error", message: "Keep the description under 3000 characters." };
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a GPX file." };
  if (file.size > MAX_GPX_BYTES) return { status: "error", message: "GPX files must be 2.5 MB or smaller." };
  if (!/\.gpx$/i.test(file.name)) return { status: "error", message: "Upload a .gpx file." };

  let points;
  try {
    points = parseGpx(await file.text());
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not read that GPX file." };
  }
  const elevation = elevationStats(points);
  const isManager = current.user.roles.includes("programme_manager") || current.user.roles.includes("admin");
  const slug = `${slugify(name.data)}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await current.supabase
    .from("routes")
    .insert({
      slug,
      name: name.data,
      description: description.data,
      area,
      path: toWkt(points),
      elevation_gain_m: elevation?.gain ?? null,
      elevation_loss_m: elevation?.loss ?? null,
      elevation_profile: elevation?.profile ?? null,
      source: "gpx",
      source_ref: file.name.slice(0, 200),
      source_attribution: `GPX track uploaded by a HYD Runners contributor on ${new Date().toISOString().slice(0, 10)}`,
      status: isManager && formData.get("publish") === "on" ? "published" : "draft",
    })
    .select("slug")
    .single();
  if (error) return { status: "error", message: failMsg(error, "Could not save the route.") };
  revalidatePath("/routes");
  redirect(`/routes/${data.slug}`);
}

export async function updateRouteAction(_prev: RouteFormState, formData: FormData): Promise<RouteFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const routeId = z.uuid().safeParse(formData.get("routeId"));
  if (!routeId.success) return { status: "error", message: "Route not found." };
  const attrs = parseAttributes(formData);
  if (!attrs.ok) return { status: "error", message: attrs.message };
  const a = attrs.data;
  const patch: Record<string, unknown> = {
    surface: a.surface,
    terrain: a.terrain,
    difficulty: a.difficulty,
    lighting: a.lighting,
    shade: a.shade,
    beginner_suitable: a.beginnerSuitable,
    water_refill: a.waterRefill,
    toilets: a.toilets,
    parking: a.parking,
    meeting_point: a.meetingPoint,
    traffic_notes: a.trafficNotes,
  };
  const status = formData.get("status");
  if (status === "draft" || status === "published" || status === "archived") patch.status = status;
  // A hidden "" plus the checkbox: verified only when the checkbox value is present.
  if (formData.has("verified")) patch.verified = formData.getAll("verified").includes("on");
  const { error, count } = await current.supabase
    .from("routes")
    .update(patch, { count: "exact" })
    .eq("id", routeId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not save the route.") };
  if (count === 0) return { status: "error", message: "You can't edit this route." };
  revalidatePath("/routes");
  revalidatePath(`/routes/${String(formData.get("slug") ?? "")}`);
  return { status: "success", message: "Route saved." };
}

const stars = z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]).transform((v) => (v === "" ? null : v));

export async function reviewRouteAction(_prev: RouteFormState, formData: FormData): Promise<RouteFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = z
    .object({
      routeId: z.uuid(),
      rating: z.coerce.number().int().min(1, "Give an overall rating.").max(5),
      safety: stars,
      shade: stars,
      surface: stars,
      crowd: stars,
      comment: z
        .string()
        .trim()
        .max(1000)
        .transform((v) => (v === "" ? null : v)),
    })
    .safeParse({
      routeId: formData.get("routeId"),
      rating: formData.get("rating"),
      safety: formData.get("safety") ?? "",
      shade: formData.get("shade") ?? "",
      surface: formData.get("surface") ?? "",
      crowd: formData.get("crowd") ?? "",
      comment: formData.get("comment") ?? "",
    });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const r = parsed.data;
  // Update first, then insert: an upsert would need UPDATE on the key columns,
  // which runners deliberately do not have (a review cannot move routes).
  const values = {
    rating: r.rating,
    safety: r.safety,
    shade: r.shade,
    surface: r.surface,
    crowd: r.crowd,
    comment: r.comment,
  };
  const updated = await current.supabase
    .from("route_reviews")
    .update(values, { count: "exact" })
    .eq("route_id", r.routeId)
    .eq("user_id", current.user.id);
  if (updated.error) return { status: "error", message: failMsg(updated.error, "Could not save your review.") };
  if (updated.count === 0) {
    const { error } = await current.supabase
      .from("route_reviews")
      .insert({ route_id: r.routeId, user_id: current.user.id, ...values });
    if (error) return { status: "error", message: failMsg(error, "Could not save your review.") };
  }
  revalidatePath(`/routes/${String(formData.get("slug") ?? "")}`);
  return { status: "success", message: "Thanks for the review." };
}

export async function reportConditionAction(_prev: RouteFormState, formData: FormData): Promise<RouteFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = z
    .object({
      routeId: z.uuid(),
      kind: z.enum(
        ["hazard", "closure", "construction", "lighting", "traffic", "water", "other"],
        "Choose what you saw.",
      ),
      note: z.string().trim().min(3, "Describe what you saw.").max(500),
    })
    .safeParse({ routeId: formData.get("routeId"), kind: formData.get("kind"), note: formData.get("note") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const { error } = await current.supabase.from("route_reports").insert({
    route_id: parsed.data.routeId,
    reporter_id: current.user.id,
    kind: parsed.data.kind,
    note: parsed.data.note,
  });
  if (error) return { status: "error", message: failMsg(error, "Could not send the report.") };
  revalidatePath(`/routes/${String(formData.get("slug") ?? "")}`);
  return { status: "success", message: "Thanks. Other runners will see this for the next two weeks." };
}

export async function resolveConditionAction(_prev: RouteFormState, formData: FormData): Promise<RouteFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const reportId = z.uuid().safeParse(formData.get("reportId"));
  if (!reportId.success) return { status: "error", message: "Report not found." };
  const { error, count } = await current.supabase
    .from("route_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: current.user.id }, { count: "exact" })
    .eq("id", reportId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not resolve the report.") };
  if (count === 0) return { status: "error", message: "Only programme managers resolve reports." };
  revalidatePath(`/routes/${String(formData.get("slug") ?? "")}`);
  return { status: "success", message: "Marked as resolved." };
}
