import type { ExtractedTimetable } from "@/lib/contracts";

/**
 * Provider-neutral AI interfaces. Features depend on these types only; the
 * scheduler never imports an SDK. Each capability must have a deterministic
 * fallback that works when `getAiProvider()` returns null.
 */

export type TimetableFile = {
  bytes: Uint8Array;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
};

export type AiCallMeta = {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export interface TimetableExtractor {
  /** Must return data that already passed `ExtractedTimetable` validation. */
  extractTimetable(file: TimetableFile): Promise<{ result: ExtractedTimetable; meta: AiCallMeta }>;
}

export type AiProvider = TimetableExtractor;

export class AiUnavailableError extends Error {
  constructor(message = "AI provider is not configured") {
    super(message);
    this.name = "AiUnavailableError";
  }
}
