import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/features/identity/logic/auth";
import { callbackFailurePath, hasAuthErrorParams, RESET_PASSWORD_PATH } from "@/features/identity/logic/password-reset";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes email confirmation, password recovery and OAuth sign-in by
 * exchanging the PKCE code for a session.
 *
 * Redirects stay on the origin that received the request: the session cookie
 * set here belongs to that host. `next` is accepted only as a same-origin
 * relative path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const fail = () => NextResponse.redirect(new URL(callbackFailurePath(next), origin));

  // Expired or already-used links come back as ?error=…&error_code=otp_expired.
  // The description is never forwarded to the page.
  if (!isSupabaseConfigured || !code || hasAuthErrorParams(searchParams)) return fail();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail();

  // A recovery code always continues to the reset page, whatever `next` says.
  // auth-js returns `redirectType` at runtime but leaves it out of the type.
  const { redirectType } = data as { redirectType?: string | null };
  const target = redirectType === "recovery" ? RESET_PASSWORD_PATH : next;
  return NextResponse.redirect(new URL(target, origin));
}
