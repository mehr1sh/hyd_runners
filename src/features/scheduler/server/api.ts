import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai";
import { isStructuredGenerator, type StructuredGenerator } from "@/lib/ai/structured";
import type { TimetableExtractor } from "@/lib/ai/provider";
import { fail } from "@/lib/api/response";
import { getRequestUser, type RequestUser } from "@/lib/auth/request-user";
import { isSupabaseConfigured } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { aiCallsInLastDay } from "./data";

/** Shared plumbing for the planner's route handlers. */

export type Caller = { user: RequestUser; supabase: SupabaseClient };

export async function requireCaller(
  request: Request,
): Promise<{ ok: true; caller: Caller } | { ok: false; response: NextResponse }> {
  if (!isSupabaseConfigured) {
    return { ok: false, response: fail("internal_error", "Supabase is not configured on this deployment.") };
  }
  const caller = await getRequestUser(request);
  if (!caller) return { ok: false, response: fail("unauthenticated", "Sign in to continue.") };
  return { ok: true, caller };
}

/** Log the failure class only (no bodies, no personal data) and return a safe 500. */
export function internalError(context: string, error: unknown, message = "Something went wrong. Please try again.") {
  const code = (error as { code?: string } | null)?.code;
  const name = (error as { name?: string } | null)?.name;
  console.error(`[scheduler] ${context} failed: ${name ?? "Error"}${code ? ` (${code})` : ""}`);
  return fail("internal_error", message);
}

export function isAiConfigured() {
  return getAiProvider() !== null;
}

/**
 * The AI capabilities available to this caller right now. Returns null
 * capabilities with a reason when AI is off, unconfigured or the runner has
 * used up `AI_DAILY_CALL_LIMIT` in the last 24 hours.
 */
export async function aiForCaller(supabase: SupabaseClient): Promise<{
  extractor: TimetableExtractor | null;
  generator: StructuredGenerator | null;
  unavailable: "not_configured" | "rate_limited" | null;
}> {
  const provider = getAiProvider();
  if (!provider) return { extractor: null, generator: null, unavailable: "not_configured" };
  let used = 0;
  try {
    used = await aiCallsInLastDay(supabase);
  } catch {
    // If usage cannot be read, fail closed: no AI call this time.
    return { extractor: null, generator: null, unavailable: "rate_limited" };
  }
  if (used >= serverEnv.AI_DAILY_CALL_LIMIT) return { extractor: null, generator: null, unavailable: "rate_limited" };
  return { extractor: provider, generator: isStructuredGenerator(provider) ? provider : null, unavailable: null };
}
