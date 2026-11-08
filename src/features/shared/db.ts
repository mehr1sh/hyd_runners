import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestError } from "@supabase/supabase-js";
import type { ErrorCode } from "@/lib/contracts";

export type ServiceResult<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; details?: unknown };

export function dbFailure(error: PostgrestError, message: string): ServiceResult<never> {
  if (error.code === "42501" || error.code === "PGRST301") {
    return { ok: false, code: "forbidden", message: "You do not have access to do that." };
  }
  if (error.code === "PT429") {
    return {
      ok: false,
      code: "rate_limited",
      message: "You're doing that a lot right now. Please wait a few minutes and try again.",
    };
  }
  if (error.code === "22023") {
    return { ok: false, code: "validation_failed", message: "One of the values isn't valid. Check it and try again." };
  }
  if (error.code === "23505") {
    return { ok: false, code: "conflict", message: "That record already exists." };
  }
  if (error.code === "23514" || error.code === "23503" || error.code === "22P02") {
    return { ok: false, code: "validation_failed", message: "Some fields are missing or invalid." };
  }
  console.error(message, error.code);
  return { ok: false, code: "internal_error", message };
}

/**
 * Reads every row of a query in pages. The Data API returns at most 1000 rows
 * per request (Supabase `max_rows`), so a plain `.limit(5000)` is silently cut
 * to 1000. `page(from, to)` must apply a stable, unique ordering and
 * `.range(from, to)`.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  size = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < size) return rows;
  }
}

/**
 * Display names for profile ids the caller may read (RLS decides), fetched in
 * batches of 100 so a long list never produces an over-long request URL.
 * Failures are logged; unknown ids are simply absent from the map.
 */
export async function profileNames(
  supabase: SupabaseClient,
  ids: (string | null | undefined)[],
  context = "profiles",
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", unique.slice(i, i + 100));
    if (error) console.error(`[${context}] could not load names`, error.code);
    for (const row of (data ?? []) as { id: string; display_name: string }[]) names.set(row.id, row.display_name);
  }
  return names;
}
