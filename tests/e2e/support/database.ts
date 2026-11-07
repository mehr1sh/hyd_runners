import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Vercel Production and Preview share one Supabase project. Specs that create
 * accounts or change data run only when the app under test uses a disposable
 * local Supabase stack. Against a deployed URL (PLAYWRIGHT_BASE_URL) only
 * read-only specs run, signed in as a dedicated test account.
 */

export const PASSWORD = "correct-horse-battery";
export const WRITES_DATA = "Creates accounts or data: runs only against local Supabase, never a shared database";

export function localEnv(name: string) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackUrl(url: string | undefined) {
  if (!url) return false;
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** True only when the app is served locally and talks to a local Supabase stack. */
export function usesLocalDatabase() {
  return !process.env.PLAYWRIGHT_BASE_URL && isLoopbackUrl(localEnv("NEXT_PUBLIC_SUPABASE_URL"));
}

/** Secret-key client for seeding, available only against local Supabase. */
export function adminClient(): SupabaseClient | null {
  const url = localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = localEnv("SUPABASE_SECRET_KEY");
  if (!usesLocalDatabase() || !url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Unique, clearly-labelled address for accounts created by a local run. */
export function testEmail(label: string, project: string) {
  return `e2e-${label}-${project}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
}

/**
 * The dedicated read-only test account. Against a deployed URL it comes from
 * E2E_RUNNER_EMAIL / E2E_RUNNER_PASSWORD; locally it is created on demand.
 */
export async function testAccount(): Promise<{ email: string; password: string } | null> {
  if (!usesLocalDatabase()) {
    const email = process.env.E2E_RUNNER_EMAIL;
    const password = process.env.E2E_RUNNER_PASSWORD;
    return email && password ? { email, password } : null;
  }
  const admin = adminClient();
  if (!admin) return null;
  const email = "e2e-runner@example.test";
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "E2E Runner" },
  });
  if (error && error.code !== "email_exists") throw new Error(`Could not create ${email}: ${error.message}`);
  return { email, password: PASSWORD };
}
