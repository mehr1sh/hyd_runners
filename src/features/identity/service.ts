import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitnessLevel, PrimaryNeed, Role } from "@/lib/contracts";
import { dbFailure, type ServiceResult } from "@/features/shared/db";
import { OnboardingPreferences, type ExperienceInput, type PlacesInput, type TrainingInput } from "./logic/onboarding";

export type OnboardingRecord = {
  displayName: string;
  fitnessLevel: FitnessLevel | null;
  primaryNeed: PrimaryNeed | null;
  timezone: string;
  onboardedAt: string | null;
  preferences: OnboardingPreferences | null;
};

function iso(value: string | null) {
  return value ? new Date(value).toISOString() : null;
}

export async function loadOnboarding(
  supabase: SupabaseClient,
  userId: string,
): Promise<ServiceResult<OnboardingRecord>> {
  const [{ data: profile, error: profileError }, { data: prefs, error: prefsError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, fitness_level, primary_need, timezone, onboarded_at")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (profileError) return dbFailure(profileError, "Could not load your profile.");
  if (prefsError) return dbFailure(prefsError, "Could not load your preferences.");
  if (!profile) return { ok: false, code: "not_found", message: "Profile not found." };

  const preferences = prefs
    ? OnboardingPreferences.parse({
        userId: prefs.user_id,
        goal: prefs.goal,
        preferredDays: prefs.preferred_days ?? [],
        preferredTimesOfDay: prefs.preferred_times_of_day ?? [],
        sessionsPerWeek: prefs.sessions_per_week,
        maxSessionMinutes: prefs.max_session_minutes,
        timezone: prefs.timezone,
        remindersEnabled: prefs.reminders_enabled,
        preferredActivities: prefs.preferred_activities ?? [],
        preferredLocationIds: prefs.preferred_location_ids ?? [],
        notifyInApp: prefs.notify_in_app,
      })
    : null;

  return {
    ok: true,
    data: {
      displayName: profile.display_name,
      fitnessLevel: profile.fitness_level,
      primaryNeed: profile.primary_need,
      timezone: profile.timezone,
      onboardedAt: iso(profile.onboarded_at),
      preferences,
    },
  };
}

export async function saveExperience(
  supabase: SupabaseClient,
  userId: string,
  input: ExperienceInput,
): Promise<ServiceResult<{ onboardedAt: string | null }>> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName,
      fitness_level: input.fitnessLevel,
      primary_need: input.primaryNeed,
      timezone: input.timezone,
    })
    .eq("id", userId)
    .select("onboarded_at")
    .maybeSingle();
  if (error) return dbFailure(error, "Could not save your answers.");
  if (!data) return { ok: false, code: "forbidden", message: "You can only edit your own profile." };
  return { ok: true, data: { onboardedAt: iso(data.onboarded_at) } };
}

async function knownLocationIds(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return { ids: [] as string[], missing: [] as string[] };
  const { data, error } = await supabase.from("locations").select("id").in("id", ids);
  if (error) return { error };
  const found = new Set((data ?? []).map((row) => row.id as string));
  return { ids: ids.filter((id) => found.has(id)), missing: ids.filter((id) => !found.has(id)) };
}

export async function saveTraining(
  supabase: SupabaseClient,
  userId: string,
  input: TrainingInput,
  timezone: string,
): Promise<ServiceResult<null>> {
  const existing = await supabase
    .from("user_preferences")
    .select("preferred_location_ids, reminders_enabled, notify_in_app")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) return dbFailure(existing.error, "Could not save your training preferences.");

  const fields = {
    goal: input.goal,
    preferred_days: input.preferredDays,
    preferred_times_of_day: input.preferredTimesOfDay,
    sessions_per_week: input.sessionsPerWeek,
    max_session_minutes: input.maxSessionMinutes,
    timezone,
    reminders_enabled: existing.data?.reminders_enabled ?? false,
    preferred_activities: input.preferredActivities,
    preferred_location_ids: existing.data?.preferred_location_ids ?? [],
    notify_in_app: existing.data?.notify_in_app ?? true,
  };
  // Not an upsert: PostgREST's ON CONFLICT DO UPDATE also sets user_id, and
  // authenticated has no UPDATE privilege on that column.
  const { error } = existing.data
    ? await supabase.from("user_preferences").update(fields).eq("user_id", userId)
    : await supabase.from("user_preferences").insert({ user_id: userId, ...fields });
  if (error) return dbFailure(error, "Could not save your training preferences.");
  return { ok: true, data: null };
}

export async function savePlaces(
  supabase: SupabaseClient,
  userId: string,
  input: PlacesInput,
  complete: boolean,
): Promise<ServiceResult<null>> {
  const locations = await knownLocationIds(supabase, input.preferredLocationIds);
  if ("error" in locations && locations.error) return dbFailure(locations.error, "Could not check locations.");
  if ("missing" in locations && locations.missing.length > 0) {
    return { ok: false, code: "validation_failed", message: "Choose a location from the list." };
  }

  const { data: prefs, error: prefsError } = await supabase
    .from("user_preferences")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (prefsError) return dbFailure(prefsError, "Could not save your places.");
  if (!prefs) {
    return { ok: false, code: "validation_failed", message: "Save your training preferences before choosing places." };
  }

  const { error } = await supabase
    .from("user_preferences")
    .update({
      preferred_location_ids: locations.ids,
      reminders_enabled: input.remindersEnabled,
      notify_in_app: input.notifyInApp,
    })
    .eq("user_id", userId);
  if (error) return dbFailure(error, "Could not save your places.");

  if (complete) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", userId)
      .is("onboarded_at", null);
    if (profileError) return dbFailure(profileError, "Could not finish setup.");
  }
  return { ok: true, data: null };
}

export async function loadRoles(supabase: SupabaseClient, userId: string): Promise<ServiceResult<Role[]>> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return dbFailure(error, "Could not check your role.");
  return { ok: true, data: (data ?? []).map((row) => row.role as Role) };
}
