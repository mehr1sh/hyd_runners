import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

/** Route prefixes that require a signed-in user. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/schedule",
  "/programmes",
  "/workouts",
  "/reports",
  "/community",
  "/events",
  "/clubs",
  "/runs",
  "/routes",
  "/train",
  "/activities",
  "/explore",
  "/map",
  "/profile",
  "/coach",
  "/manager",
] as const;

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * signed-out visitors away from protected routes. Authorization itself is
 * enforced by RLS; this redirect only improves the experience.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
    // Local shells without Supabase: allow browsing, pages show a setup notice.
    return response;
  }

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Do not add logic between client creation and getClaims(): it refreshes the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
