"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { dbFailure } from "@/features/shared/db";
import { parseSeriesForm } from "./logic";

export type SeriesFormState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Sign in to continue." };
  return { ok: true as const, user, supabase: await createClient() };
}

function message(error: { code?: string; message: string }, fallback: string) {
  if (
    ["23514", "22023", "P0002"].includes(error.code ?? "") ||
    (error.code === "42501" && /series|organis/i.test(error.message))
  ) {
    return error.message;
  }
  if (error.code === "42501") return "Only programme managers and club admins can manage group runs.";
  const failed = dbFailure(error as never, fallback);
  return failed.ok ? fallback : failed.message;
}

export async function createSeriesAction(_prev: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseSeriesForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const s = parsed.data;
  const { data, error } = await current.supabase
    .from("group_run_series")
    .insert({
      club_id: s.clubId,
      title: s.title,
      description: s.description,
      location_id: s.locationId,
      meeting_point: s.meetingPoint,
      weekday: s.weekday,
      start_time: s.startTime,
      duration_minutes: s.durationMinutes,
      capacity: s.capacity,
      beginner_friendly: s.beginnerFriendly,
      no_drop: s.noDrop,
      regroup_policy: s.regroupPolicy,
      created_by: current.user.id,
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: message(error, "Could not create the group run.") };
  const { error: scheduleError } = await current.supabase.rpc("schedule_series_runs", {
    p_series_id: data.id,
    p_weeks: 4,
  });
  if (scheduleError)
    return { status: "error", message: message(scheduleError, "Created, but the runs could not be scheduled.") };
  revalidatePath("/runs");
  revalidatePath("/events");
  redirect(`/runs/${data.id}`);
}

export async function scheduleSeriesAction(_prev: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const id = z.uuid().safeParse(formData.get("seriesId"));
  const weeks = z
    .number()
    .int()
    .min(1)
    .max(8)
    .safeParse(Number(formData.get("weeks") ?? 4));
  if (!id.success || !weeks.success) return { status: "error", message: "Choose 1 to 8 weeks." };
  const { data, error } = await current.supabase.rpc("schedule_series_runs", {
    p_series_id: id.data,
    p_weeks: weeks.data,
  });
  if (error) return { status: "error", message: message(error, "Could not schedule runs.") };
  revalidatePath(`/runs/${id.data}`);
  revalidatePath("/runs");
  revalidatePath("/events");
  const created = Number(data ?? 0);
  return {
    status: "success",
    message:
      created === 0
        ? "Already scheduled for that period."
        : `Scheduled ${created} more run${created === 1 ? "" : "s"}.`,
  };
}

export async function toggleSeriesAction(_prev: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const id = z.uuid().safeParse(formData.get("seriesId"));
  if (!id.success) return { status: "error", message: "Series not found." };
  const active = formData.get("active") === "true";
  const { error, count } = await current.supabase
    .from("group_run_series")
    .update({ active }, { count: "exact" })
    .eq("id", id.data);
  if (error) return { status: "error", message: message(error, "Could not update the series.") };
  if (count === 0)
    return { status: "error", message: "Only programme managers and club admins can manage group runs." };
  revalidatePath(`/runs/${id.data}`);
  revalidatePath("/runs");
  return {
    status: "success",
    message: active ? "Series resumed." : "Series paused. Already scheduled runs stay on the calendar.",
  };
}
