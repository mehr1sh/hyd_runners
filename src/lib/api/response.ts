import { NextResponse } from "next/server";
import type { z } from "zod";
import { ERROR_STATUS, type ApiError, type ApiSuccess, type ErrorCode, type PageMeta } from "@/lib/contracts";

/** 2xx response in the standard envelope: `{ data, meta? }`. */
export function ok<T>(data: T, init?: { status?: number; meta?: PageMeta }) {
  const body: ApiSuccess<T> = init?.meta ? { data, meta: init.meta } : { data };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

/** Error response in the standard envelope: `{ error: { code, message, details? } }`. */
export function fail(code: ErrorCode, message: string, details?: unknown) {
  const body: ApiError = { error: details === undefined ? { code, message } : { code, message, details } };
  return NextResponse.json(body, { status: ERROR_STATUS[code] });
}

/** Parse a JSON body against a contract schema, returning a ready-made 4xx on failure. */
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail("bad_request", "Request body must be valid JSON.") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: fail("validation_failed", "Some fields are missing or invalid.", result.error.issues),
    };
  }
  return { ok: true, data: result.data };
}
