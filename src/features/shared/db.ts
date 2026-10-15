import type { PostgrestError } from "@supabase/supabase-js";
import type { ErrorCode } from "@/lib/contracts";

export type ServiceResult<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; details?: unknown };

export function dbFailure(error: PostgrestError, message: string): ServiceResult<never> {
  if (error.code === "42501" || error.code === "PGRST301") {
    return { ok: false, code: "forbidden", message: "You do not have access to do that." };
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
