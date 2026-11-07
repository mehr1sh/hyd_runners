import type { z } from "zod";
import type { AiCallMeta, TimetableFile } from "./provider";

/**
 * Provider-neutral structured generation. Features build their own prompt and
 * schema and receive data that already passed the schema, so they never see
 * a provider's response format. A provider that supports it implements this
 * next to `TimetableExtractor`.
 */
export interface StructuredGenerator {
  generateStructured<S extends z.ZodType>(
    schema: S,
    request: { system: string; text: string; file?: TimetableFile; maxOutputTokens?: number },
  ): Promise<{ result: z.infer<S>; meta: AiCallMeta }>;
}

export type AiFailureKind =
  | "timeout"
  | "auth"
  | "rate_limited"
  | "bad_request"
  | "server"
  | "network"
  | "blocked"
  | "malformed"
  | "invalid_output";

/** Every provider failure is reported as this, so callers can fall back without knowing the provider. */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function isStructuredGenerator(value: unknown): value is StructuredGenerator {
  return typeof (value as StructuredGenerator | null)?.generateStructured === "function";
}
