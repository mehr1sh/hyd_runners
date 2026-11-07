import type { ExtractedTimetable } from "@/lib/contracts";
import type { AiFailureKind } from "@/lib/ai/structured";
import { checkStoredBytes, type TimetableMimeType } from "../logic/upload-validation";
import { parseTimetableText } from "../logic/timetable-text";
import { isLocalTime, toMinutes } from "../logic/time";
import type { AvailabilityDraft } from "../logic/types";

/**
 * Timetable processing pipeline. Dependencies (PDF text reader, AI extractor)
 * are injected so every failure path can be tested without a provider.
 *
 *   stored bytes ─▶ type/size check ─▶ PDF? ─▶ text layer ─▶ rule parser ─┐
 *                                       │                                ├─▶ drafts for review
 *                                       └─ image, scanned PDF or partial ─▶ AI (if configured) ─┘
 *
 * Success means "there is something for the runner to review", never
 * "availability is confirmed". Nothing here writes to the database.
 */

export type AiExtractFn = (file: { bytes: Uint8Array; mimeType: TimetableMimeType }) => Promise<ExtractedTimetable>;

export type AiAttempt = { attempted: boolean; ok: boolean; kind: AiFailureKind | null; latencyMs: number | null };

export type ProcessingFailureCode =
  | "empty_file"
  | "file_too_large"
  | "unsupported_type"
  | "content_mismatch"
  | "corrupted_pdf"
  | "no_text"
  | "nothing_found"
  | "image_needs_ai"
  | "ai_failed";

export type ProcessingResult =
  | {
      ok: true;
      method: "text_parser" | "ai";
      /** `complete` only when every row was read without doubt; review is still required. */
      completeness: "complete" | "partial";
      drafts: AvailabilityDraft[];
      notes: string[];
      ai: AiAttempt;
    }
  | { ok: false; code: ProcessingFailureCode; message: string; retryable: boolean; ai: AiAttempt };

const FREE_RE = /\b(free|available|availability)\b/i;
const LOW_CONFIDENCE = 0.7;

export function draftsFromExtraction(extracted: ExtractedTimetable, makeKey: () => string): AvailabilityDraft[] {
  return extracted.blocks.map((b) => {
    const uncertainties: string[] = [];
    let startTime: string | null = b.startTime;
    let endTime: string | null = b.endTime;
    if (!isLocalTime(startTime) || !isLocalTime(endTime) || toMinutes(endTime) <= toMinutes(startTime)) {
      uncertainties.push(`The times read (${b.startTime}–${b.endTime}) are not a valid period; enter them by hand.`);
      startTime = null;
      endTime = null;
    }
    if (b.confidence < LOW_CONFIDENCE) uncertainties.push("The AI was not sure it read this row correctly.");
    return {
      key: makeKey(),
      weekday: b.weekday,
      startTime,
      endTime,
      kind: b.label && FREE_RE.test(b.label) ? "free" : "busy",
      label: b.label,
      source: "ai",
      confidence: b.confidence,
      uncertainties,
      rawText: null,
      confirmed: false,
    };
  });
}

const NO_AI: AiAttempt = { attempted: false, ok: false, kind: null, latencyMs: null };

export async function processTimetable(input: {
  bytes: Uint8Array;
  mimeType: TimetableMimeType;
  extractPdfText: (bytes: Uint8Array) => Promise<string>;
  /** null when AI is not configured or the runner's daily limit is used up. */
  aiExtract: AiExtractFn | null;
  makeKey: () => string;
}): Promise<ProcessingResult> {
  const rejection = checkStoredBytes(input.bytes, input.mimeType);
  if (rejection) return { ok: false, code: rejection.code, message: rejection.message, retryable: false, ai: NO_AI };

  let ai: AiAttempt = NO_AI;
  const runAi = async (): Promise<ExtractedTimetable | null> => {
    if (!input.aiExtract) return null;
    const started = performance.now();
    try {
      const result = await input.aiExtract({ bytes: input.bytes, mimeType: input.mimeType });
      ai = { attempted: true, ok: true, kind: null, latencyMs: Math.round(performance.now() - started) };
      return result;
    } catch (error) {
      const kind = (error as { kind?: AiFailureKind }).kind ?? "server";
      ai = { attempted: true, ok: false, kind, latencyMs: Math.round(performance.now() - started) };
      return null;
    }
  };

  const aiSuccess = (extracted: ExtractedTimetable): ProcessingResult | null => {
    const drafts = draftsFromExtraction(extracted, input.makeKey);
    if (drafts.length === 0) return null;
    const notes = extracted.notes ? [extracted.notes] : [];
    if (!drafts.some((d) => d.kind === "free")) {
      notes.push("The timetable lists busy times only. Confirm when you are free before planning.");
    }
    const partial = notes.length > 1 || extracted.notes !== null || drafts.some((d) => d.uncertainties.length > 0);
    return { ok: true, method: "ai", completeness: partial ? "partial" : "complete", drafts, notes, ai };
  };

  if (input.mimeType !== "application/pdf") {
    if (!input.aiExtract) {
      return {
        ok: false,
        code: "image_needs_ai",
        message:
          "Reading timetable photos needs the AI service, which is not available right now. Enter your times by hand below, or upload a PDF with selectable text.",
        retryable: false,
        ai,
      };
    }
    const extracted = await runAi();
    if (!extracted) {
      return {
        ok: false,
        code: "ai_failed",
        message: "We could not read this image right now. Try again in a minute, or enter your times by hand.",
        retryable: true,
        ai,
      };
    }
    return (
      aiSuccess(extracted) ?? {
        ok: false,
        code: "nothing_found",
        message: `No timetable entries were found in this image.${extracted.notes ? ` ${extracted.notes}` : ""} Enter your times by hand.`,
        retryable: false,
        ai,
      }
    );
  }

  let text: string;
  try {
    text = await input.extractPdfText(input.bytes);
  } catch {
    return {
      ok: false,
      code: "corrupted_pdf",
      message:
        "This PDF could not be opened. It may be damaged or password-protected. Export it again, or enter your times by hand.",
      retryable: false,
      ai,
    };
  }

  const parsed = parseTimetableText(text, input.makeKey);
  if (parsed.status === "complete") {
    return {
      ok: true,
      method: "text_parser",
      completeness: "complete",
      drafts: parsed.drafts,
      notes: parsed.notes,
      ai,
    };
  }

  const extracted = await runAi();
  if (extracted) {
    const fromAi = aiSuccess(extracted);
    if (fromAi) return fromAi;
  }

  if (parsed.status === "partial") {
    const notes = [...parsed.notes];
    if (ai.attempted && !ai.ok) notes.unshift("The AI check failed, so this shows only what the text reader found.");
    return { ok: true, method: "text_parser", completeness: "partial", drafts: parsed.drafts, notes, ai };
  }

  if (ai.attempted && !ai.ok) {
    return {
      ok: false,
      code: "ai_failed",
      message: "We could not read this timetable right now. Try again in a minute, or enter your times by hand.",
      retryable: true,
      ai,
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      code: "no_text",
      message: input.aiExtract
        ? "This PDF has no readable text and the AI could not find any timetable entries. Enter your times by hand."
        : "This PDF has no selectable text (it is probably a scan). Reading scans needs the AI service, which is not available. Enter your times by hand.",
      retryable: false,
      ai,
    };
  }
  return {
    ok: false,
    code: "nothing_found",
    message: "No days and times were found in this PDF. Enter your times by hand.",
    retryable: false,
    ai,
  };
}
