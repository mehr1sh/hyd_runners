import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/features/gamification/service";
import { localDate } from "@/features/gamification/logic/time";

/**
 * Per-request runner context for runner-experience pages: the verified user,
 * a Supabase client acting as them (RLS applies), their timezone and today's
 * local date. Returns null in preview mode (no Supabase).
 */
export const getRunnerContext = cache(async () => {
  if (!isSupabaseConfigured) return null;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const supabase = await createClient();
  const timezone = await getUserTimezone(supabase, user.id);
  const { data } = await supabase.auth.getClaims();
  const meta = (data?.claims?.user_metadata ?? {}) as { demo?: boolean };
  return { user, supabase, timezone, today: localDate(new Date(), timezone), isDemo: meta.demo === true };
});

export type RunnerContext = NonNullable<Awaited<ReturnType<typeof getRunnerContext>>>;
