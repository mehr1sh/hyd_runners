"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage, safeNextPath } from "./logic/auth";
import { isValidTimeZone, parseExperienceForm, parsePlacesForm, parseTrainingForm } from "./logic/onboarding";
import { saveExperience, savePlaces, saveTraining } from "./service";

export type AuthFormState = { status: "idle" | "error" | "check_email"; message?: string };

const Credentials = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

const SignUpForm = Credentials.extend({
  displayName: z.string().trim().min(1, "Tell us what to call you.").max(60),
});

export type FormState = { status: "idle" | "error" | "success"; message?: string };

type SignedInSession =
  | {
      ok: true;
      user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; message: string };

async function signedInClient(): Promise<SignedInSession> {
  if (!isSupabaseConfigured) return { ok: false, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Sign in to continue." };
  return { ok: true, user, supabase: await createClient() };
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Sign-in is unavailable in preview mode." };

  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: authErrorMessage(error.code, "sign-in") };

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Sign-up is unavailable in preview mode." };

  const parsed = SignUpForm.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { status: "error", message: authErrorMessage(error.code, "sign-up") };

  // With email confirmation on, there is no session until the link is clicked.
  if (!data.session) return { status: "check_email" };
  redirect("/onboarding");
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

export async function saveExperienceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await signedInClient();
  if (!session.ok) return { status: "error", message: session.message };
  const parsed = parseExperienceForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const saved = await saveExperience(session.supabase, session.user.id, parsed.data);
  if (!saved.ok) return { status: "error", message: saved.message };
  revalidatePath("/onboarding");
  revalidatePath("/profile");
  return { status: "success", message: "Experience saved. Continue when you are ready." };
}

export async function saveTrainingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await signedInClient();
  if (!session.ok) return { status: "error", message: session.message };
  const parsed = parseTrainingForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const timezone = String(formData.get("timezone") || "Asia/Kolkata");
  if (!isValidTimeZone(timezone)) return { status: "error", message: "Enter a timezone such as Asia/Kolkata." };
  const saved = await saveTraining(session.supabase, session.user.id, parsed.data, timezone);
  if (!saved.ok) return { status: "error", message: saved.message };
  revalidatePath("/onboarding");
  revalidatePath("/profile");
  return { status: "success", message: "Training preferences saved." };
}

export async function saveProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await signedInClient();
  if (!session.ok) return { status: "error", message: session.message };
  const experience = parseExperienceForm(formData);
  if (!experience.ok) return { status: "error", message: experience.message };
  const savedExperience = await saveExperience(session.supabase, session.user.id, experience.data);
  if (!savedExperience.ok) return { status: "error", message: savedExperience.message };

  if (formData.get("goal")) {
    const training = parseTrainingForm(formData);
    if (!training.ok) return { status: "error", message: training.message };
    const savedTraining = await saveTraining(
      session.supabase,
      session.user.id,
      training.data,
      experience.data.timezone,
    );
    if (!savedTraining.ok) return { status: "error", message: savedTraining.message };
    const places = parsePlacesForm(formData);
    if (!places.ok) return { status: "error", message: places.message };
    const savedPlaces = await savePlaces(session.supabase, session.user.id, places.data, false);
    if (!savedPlaces.ok) return { status: "error", message: savedPlaces.message };
  }

  revalidatePath("/profile");
  revalidatePath("/onboarding");
  return { status: "success", message: "Profile saved." };
}

export async function savePlacesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await signedInClient();
  if (!session.ok) return { status: "error", message: session.message };
  const parsed = parsePlacesForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const saved = await savePlaces(session.supabase, session.user.id, parsed.data, true);
  if (!saved.ok) return { status: "error", message: saved.message };
  revalidatePath("/onboarding");
  revalidatePath("/profile");
  redirect("/profile");
}
