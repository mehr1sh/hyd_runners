"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { deleteActivity } from "./server/import";

export type ActivityFormState = { status: "idle" | "error" | "success"; message?: string };

export async function updateActivitySettingsAction(
  _prev: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const parsed = z
    .object({
      id: z.uuid(),
      visibility: z.enum(["private", "followers", "public"]),
      trim: z.coerce.number().pipe(z.union([z.literal(0), z.literal(200), z.literal(500), z.literal(1000)])),
      name: z
        .string()
        .trim()
        .max(120)
        .transform((v) => (v === "" ? null : v)),
    })
    .safeParse({
      id: formData.get("id"),
      visibility: formData.get("visibility"),
      trim: formData.get("trim"),
      name: formData.get("name") ?? "",
    });
  if (!parsed.success) return { status: "error", message: "Check the settings and try again." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("activities")
    .update(
      { visibility: parsed.data.visibility, privacy_trim_m: parsed.data.trim, name: parsed.data.name },
      { count: "exact" },
    )
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[activities] settings update failed", error.code);
    return { status: "error", message: "Could not save the settings." };
  }
  if (count === 0) return { status: "error", message: "Activity not found." };
  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/activities");
  return { status: "success", message: "Saved." };
}

export async function deleteActivityAction(_prev: ActivityFormState, formData: FormData): Promise<ActivityFormState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Activity not found." };
  try {
    const removed = await deleteActivity(await createClient(), user.id, id.data);
    if (!removed) return { status: "error", message: "Activity not found." };
  } catch (e) {
    console.error("[activities] delete failed", e instanceof Error ? e.message : e);
    return { status: "error", message: "Could not delete the activity." };
  }
  revalidatePath("/activities");
  redirect("/activities");
}
