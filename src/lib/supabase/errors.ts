/**
 * Errors returned by Supabase/PostgREST when the database schema the app
 * expects is not there yet (migrations not deployed): a missing table or
 * view (42P01, PGRST205), a missing column (PGRST204) or a missing
 * relationship used in an embedded select (PGRST200), a missing database
 * function (PGRST202, 42883) or a missing column (42703).
 */
export const MISSING_SCHEMA_CODES: ReadonlySet<string> = new Set([
  "42P01",
  "PGRST205",
  "PGRST204",
  "PGRST200",
  // A function or column added by a migration that has not been applied yet.
  // Vercel deploys a merge before the migration workflow runs.
  "PGRST202",
  "42883",
  "42703",
]);

type PostgrestLikeError = { message: string; code?: string | null };

/** A failed Supabase query, keeping the PostgREST/Postgres error code. */
export class DatabaseQueryError extends Error {
  readonly code: string | null;
  readonly source: string;

  constructor(source: string, error: PostgrestLikeError) {
    super(error.message);
    this.name = "DatabaseQueryError";
    this.code = error.code ?? null;
    this.source = source;
  }
}

export function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && MISSING_SCHEMA_CODES.has(code);
}
