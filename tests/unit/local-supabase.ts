/**
 * Supabase-backed tests write with the secret key, so they run only against a
 * local stack. Production and Preview share one hosted project; a hosted URL
 * in .env.local must never be written to by tests.
 */
export function isLocalSupabaseUrl(url: string | undefined) {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
