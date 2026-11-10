/**
 * Safety checks for the local demo-data runner. Demo data must never reach
 * Vercel Production or Preview, which share the production Supabase project.
 * The runner only talks to the local Supabase stack reported by
 * `supabase status`, and these checks refuse everything else.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackUrl(url) {
  if (!url) return false;
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throws with a plain explanation unless this is a local development target. */
export function assertLocalTarget({ apiUrl, dbUrl, env }) {
  if (env.VERCEL || env.VERCEL_ENV) {
    throw new Error("Refusing to seed demo data on Vercel. Demo data is for the local Supabase stack only.");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production.");
  }
  if (!isLoopbackUrl(apiUrl)) {
    throw new Error(`Refusing to seed: the Supabase API URL is not local (${safeHost(apiUrl)}).`);
  }
  if (!isLoopbackUrl(dbUrl)) {
    throw new Error(`Refusing to seed: the database URL is not local (${safeHost(dbUrl)}).`);
  }
  // A hosted project configured in the shell must not be mixed with local keys.
  if (env.NEXT_PUBLIC_SUPABASE_URL && !isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(
      `Refusing to seed: NEXT_PUBLIC_SUPABASE_URL points at ${safeHost(env.NEXT_PUBLIC_SUPABASE_URL)}. Unset it; the runner uses the local stack.`,
    );
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "an invalid URL";
  }
}

/** Parses `supabase status -o env` output (KEY="value" lines). */
export function parseStatusEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The local database container for a Supabase project id from supabase/config.toml. */
export function dbContainerFor(configToml) {
  const m = /^\s*project_id\s*=\s*"([a-z0-9_-]+)"/m.exec(configToml);
  if (!m) throw new Error("Could not read project_id from supabase/config.toml.");
  return `supabase_db_${m[1]}`;
}
