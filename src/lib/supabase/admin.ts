import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabasePublicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Privileged client using the secret key. BYPASSES ROW LEVEL SECURITY.
 *
 * Use only for work no single user may do themselves: AI processing jobs,
 * scheduled tasks and server-side awards. Always scope queries by user id
 * explicitly, and never return raw rows from this client to the browser.
 */
export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const secret = serverEnv.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set; privileged operations are unavailable.");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
