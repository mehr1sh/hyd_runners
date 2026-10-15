import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createClientForAccessToken } from "@/lib/supabase/server";

export type RequestUser = { id: string; email: string | null };

/**
 * Resolve the caller of an API route from either the web cookie session or an
 * `Authorization: Bearer <access_token>` header (future mobile app). The JWT
 * is verified with getClaims(); never trust getSession() on the server.
 *
 * Returns a Supabase client acting as that user, so RLS still applies.
 */
export async function getRequestUser(
  request: Request,
): Promise<{ user: RequestUser; supabase: SupabaseClient } | null> {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  const supabase = bearer ? createClientForAccessToken(bearer) : await createClient();
  const { data, error } = await supabase.auth.getClaims(bearer ?? undefined);
  const sub = data?.claims?.sub;
  if (error || !sub) return null;

  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { user: { id: sub, email }, supabase };
}
