import { fail, ok } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/request-user";
import { UserProfile } from "@/lib/contracts";
import { isSupabaseConfigured } from "@/lib/env";

/** GET /api/v1/me — the caller's profile and roles. Works with cookies or a bearer token. */
export async function GET(request: Request) {
  if (!isSupabaseConfigured) return fail("internal_error", "Supabase is not configured on this deployment.");

  const caller = await getRequestUser(request);
  if (!caller) return fail("unauthenticated", "Sign in to continue.");

  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] = await Promise.all([
    caller.supabase
      .from("profiles")
      .select("id, display_name, avatar_path, fitness_level, primary_need, timezone, onboarded_at, created_at")
      .eq("id", caller.user.id)
      .maybeSingle(),
    caller.supabase.from("user_roles").select("role").eq("user_id", caller.user.id),
  ]);

  if (profileError || rolesError) return fail("internal_error", "Could not load your profile.");
  if (!profile) return fail("not_found", "Profile not found.");

  const body = UserProfile.parse({
    id: profile.id,
    displayName: profile.display_name,
    avatarPath: profile.avatar_path,
    fitnessLevel: profile.fitness_level,
    primaryNeed: profile.primary_need,
    timezone: profile.timezone,
    roles: (roles ?? []).map((r) => r.role),
    onboardedAt: profile.onboarded_at ? new Date(profile.onboarded_at).toISOString() : null,
    createdAt: new Date(profile.created_at).toISOString(),
  });

  return ok(body);
}
