"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { isPreviewDeployment } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage, Credentials, safeNextPath } from "./logic/auth";
import {
  ForgotPasswordForm,
  PASSWORD_UPDATED_NOTICE,
  passwordResetRedirectUrl,
  passwordUpdateError,
  RESET_REQUESTED_MESSAGE,
  RESET_SESSION_MISSING_MESSAGE,
  ResetPasswordForm,
} from "./logic/password-reset";
import { isValidTimeZone, parseExperienceForm, parsePlacesForm, parseTrainingForm } from "./logic/onboarding";
import { saveExperience, savePlaces, saveTraining } from "./service";

export type AuthFormState = { status: "idle" | "error" | "check_email"; message?: string };

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
  // Preview shares the production database: sign in with a test account instead.
  if (isPreviewDeployment)
    return { status: "error", message: "Sign-up is turned off on preview deployments. Sign in with a test account." };

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

export type ForgotPasswordState = { status: "idle" | "error" | "sent"; message?: string };

/**
 * Starts a password reset. Never reveals whether the address has an account:
 * every well-formed request gets the same response, including when Supabase
 * fails or rate-limits (its per-address rate limit only fires for existing
 * accounts, so passing it on would leak that the account exists).
 */
export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Password reset is unavailable in preview mode." };

  const parsed = ForgotPasswordForm.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: passwordResetRedirectUrl(publicEnv.NEXT_PUBLIC_SITE_URL),
  });
  // Logged without the address; the user sees the same confirmation either way.
  if (error) console.error(`[auth] Password reset request failed (${error.code ?? error.status}): ${error.message}`);

  return { status: "sent", message: RESET_REQUESTED_MESSAGE };
}

export type ResetPasswordState = { status: "idle" | "error"; message?: string; sessionMissing?: boolean };

/** Sets a new password for the session the reset link established, then signs out other sessions. */
export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Password reset is unavailable in preview mode." };

  const parsed = ResetPasswordForm.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { status: "error", message: RESET_SESSION_MISSING_MESSAGE, sessionMissing: true };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const mapped = passwordUpdateError(error);
    if (!mapped.sessionMissing && !["same_password", "weak_password"].includes(error.code ?? "")) {
      console.error(`[auth] Password update failed (${error.code ?? error.status}): ${error.message}`);
    }
    return { status: "error", message: mapped.message, sessionMissing: mapped.sessionMissing };
  }

  // Anyone else holding a session (e.g. whoever knew the old password) is signed out.
  // The password is already changed, so a failure here is logged, not shown.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) console.error(`[auth] Could not sign out other sessions: ${signOutError.message}`);

  redirect(`/dashboard?notice=${PASSWORD_UPDATED_NOTICE}`);
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
