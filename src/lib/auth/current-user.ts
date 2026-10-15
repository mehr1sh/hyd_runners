import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@/lib/contracts";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
  displayName: string;
  roles: Role[];
  onboarded: boolean;
};

/**
 * The signed-in user for Server Components, verified with getClaims().
 * Cached per request. Returns null when signed out or Supabase is not configured.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("display_name, onboarded_at").eq("id", sub).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", sub),
  ]);

  return {
    id: sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    displayName: profile?.display_name ?? "Runner",
    roles: (roles ?? []).map((r) => r.role as Role),
    onboarded: Boolean(profile?.onboarded_at),
  };
});

/**
 * Guard for staff pages. In preview mode (no Supabase) it lets the shell render;
 * otherwise it redirects signed-out users and returns `allowed: false` for
 * users without one of the roles. RLS remains the real enforcement.
 */
export async function requireRole(allowed: readonly Role[]) {
  if (!isSupabaseConfigured) return { user: null, allowed: true, preview: true } as const;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return { user, allowed: user.roles.some((r) => allowed.includes(r)), preview: false } as const;
}
