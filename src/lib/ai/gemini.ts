import "server-only";
import { z } from "zod";
import { ExtractedTimetable } from "@/lib/contracts";
import type { AiCallMeta, TimetableExtractor, TimetableFile } from "./provider";
import { AiProviderError, type StructuredGenerator } from "./structured";

/**
 * Google Gemini adapter (REST `generateContent`, called with `fetch` so no SDK
 * dependency is needed). Everything provider-specific stays in this file:
 * request shape, auth header, error mapping and response unwrapping.
 *
 * - The key travels in the `x-goog-api-key` header, never in the URL, logs or errors.
 * - One attempt per call with a timeout; no automatic retries, so a failing
 *   provider costs one request and the caller falls back immediately.
 * - JSON output is requested, then parsed and validated with Zod here. Data
 *   that fails validation is reported as `invalid_output`, never returned.
 */

export type GeminiOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function stripFences(text: string) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function mapHttpError(status: number, body: GeminiResponse | null): AiProviderError {
  const providerStatus = body?.error?.status ?? "";
  // Gemini answers an invalid key with 400 INVALID_ARGUMENT, so check the reason too.
  const keyProblem = /api key/i.test(body?.error?.message ?? "");
  if (status === 401 || status === 403 || keyProblem || providerStatus === "PERMISSION_DENIED") {
    return new AiProviderError("auth", "The AI provider rejected the credentials.", status);
  }
  if (status === 429) return new AiProviderError("rate_limited", "The AI provider is rate limiting requests.", status);
  if (status >= 500) return new AiProviderError("server", "The AI provider had an internal error.", status);
  return new AiProviderError(
    "bad_request",
    `The AI provider rejected the request (${providerStatus || status}).`,
    status,
  );
}

export function createGeminiProvider(
  options: GeminiOptions,
): TimetableExtractor & StructuredGenerator & { name: "gemini" } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 25_000;

  async function generateStructured<S extends z.ZodType>(
    schema: S,
    request: { system: string; text: string; file?: TimetableFile; maxOutputTokens?: number },
  ): Promise<{ result: z.infer<S>; meta: AiCallMeta }> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
    const parts: Array<Record<string, unknown>> = [];
    if (request.file)
      parts.push({ inlineData: { mimeType: request.file.mimeType, data: toBase64(request.file.bytes) } });
    parts.push({ text: `${request.text}\n\nReply with JSON only, matching this JSON Schema:\n${jsonSchema}` });

    const started = performance.now();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens: request.maxOutputTokens ?? 4096,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new AiProviderError("timeout", `The AI provider did not answer within ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new AiProviderError("network", "Could not reach the AI provider.");
    }
    const latencyMs = Math.round(performance.now() - started);

    let body: GeminiResponse | null = null;
    try {
      body = (await response.json()) as GeminiResponse;
    } catch {
      body = null;
    }
    if (!response.ok) throw mapHttpError(response.status, body);
    if (!body) throw new AiProviderError("malformed", "The AI provider returned a response that was not JSON.");

    if (body.promptFeedback?.blockReason) {
      throw new AiProviderError("blocked", "The AI provider declined to process this request.");
    }
    const candidate = body.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish && ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) {
      throw new AiProviderError("blocked", "The AI provider declined to process this request.");
    }
    if (finish === "MAX_TOKENS")
      throw new AiProviderError("malformed", "The AI response was cut off before it finished.");
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new AiProviderError("malformed", "The AI provider returned an empty answer.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      throw new AiProviderError("malformed", "The AI answer was not valid JSON.");
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AiProviderError("invalid_output", "The AI answer did not match the expected structure.");
    }
    return {
      result: validated.data,
      meta: {
        provider: "gemini",
        model: options.model,
        inputTokens: body.usageMetadata?.promptTokenCount ?? null,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? null,
        latencyMs,
      },
    };
  }

  return {
    name: "gemini",
    generateStructured,
    async extractTimetable(file) {
      return generateStructured(ExtractedTimetable, {
        system: TIMETABLE_SYSTEM_PROMPT,
        text: "Extract the weekly repeating commitments from this timetable.",
        file,
      });
    },
  };
}

const TIMETABLE_SYSTEM_PROMPT = `You read student and work timetables and list the weekly repeating commitments in them.

Rules:
- Each block is one commitment on one day of the week: weekday (1 = Monday … 7 = Sunday), startTime and endTime in 24-hour HH:mm, an optional short label, and a confidence between 0 and 1.
- Only include a block when the day, start and end are all visible in the document. Never invent or estimate a missing day or time; leave that block out and describe what is missing in "notes".
- Use a confidence below 0.7 for anything hard to read (blurry, handwritten, unclear AM/PM, unclear column).
- If a commitment covers several days, output one block per day.
- One-off dated events (exams, holidays) are not weekly; mention them in "notes" instead.
- If the image or document is not a timetable or cannot be read, return no blocks and explain in "notes".
- Set "timezone" to "Asia/Kolkata" unless the document states another IANA timezone.
- Keep "notes" under 500 characters.`;
