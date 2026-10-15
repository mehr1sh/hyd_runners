// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiProviderError, type StructuredGenerator } from "@/lib/ai/structured";
import { planWeek, validateSchedule } from "@/features/scheduler/logic";
import { generateProposal, type AiScheduleSuggestion } from "@/features/scheduler/server/planner";
import { normalWeek, settings } from "./fixtures";

vi.mock("server-only", () => ({}));
const { createGeminiProvider } = await import("@/lib/ai/gemini");

const WEEK = "2026-10-19";
const base = { weekStart: WEEK, timezone: "Asia/Kolkata", availability: normalWeek, settings: settings() };

function geminiReply(text: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...extra }),
    { status: 200 },
  );
}

describe("Gemini adapter", () => {
  const schema = z.object({ answer: z.number() });
  const make = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
    createGeminiProvider({ apiKey: "secret-key", model: "test-model", fetchImpl, timeoutMs });

  it("sends the key in a header (never the URL) and validates the JSON answer", async () => {
    const fetchImpl = vi.fn(async () => geminiReply('```json\n{"answer": 42}\n```'));
    const { result, meta } = await make(fetchImpl as unknown as typeof fetch).generateStructured(schema, {
      system: "s",
      text: "t",
    });
    expect(result).toEqual({ answer: 42 });
    expect(meta.provider).toBe("gemini");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it.each([
    [
      "auth (401)",
      () => new Response(JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), { status: 401 }),
      "auth",
    ],
    [
      "auth (invalid key, 400)",
      () =>
        new Response(JSON.stringify({ error: { message: "API key not valid.", status: "INVALID_ARGUMENT" } }), {
          status: 400,
        }),
      "auth",
    ],
    ["rate limit", () => new Response("{}", { status: 429 }), "rate_limited"],
    ["server error", () => new Response("oops", { status: 503 }), "server"],
    ["non-JSON body", () => new Response("<html>", { status: 200 }), "malformed"],
    ["non-JSON answer", () => geminiReply("Sure! Here is your plan."), "malformed"],
    ["wrong structure", () => geminiReply('{"answer": "forty-two"}'), "invalid_output"],
    ["blocked prompt", () => geminiReply("", { promptFeedback: { blockReason: "SAFETY" } }), "blocked"],
    [
      "truncated answer",
      () =>
        new Response(
          JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"ans' }] } }] }),
        ),
      "malformed",
    ],
  ])("maps %s to a typed failure without leaking the key", async (_label, reply, kind) => {
    const provider = make((async () => reply()) as unknown as typeof fetch);
    const error = await provider.generateStructured(schema, { system: "s", text: "t" }).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.kind).toBe(kind);
    expect(String(error.message)).not.toContain("secret-key");
  });

  it("times out instead of hanging", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch;
    const error = await make(hang, 50)
      .generateStructured(schema, { system: "s", text: "t" })
      .catch((e) => e);
    expect(error.kind).toBe("timeout");
  });

  it("reports network failures", async () => {
    const error = await make((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch)
      .generateStructured(schema, { system: "s", text: "t" })
      .catch((e) => e);
    expect(error.kind).toBe("network");
  });
});

describe("Case H: missing AI credentials", () => {
  it("returns the deterministic plan and makes no provider call", async () => {
    const { result, ai } = await generateProposal({ ...base, generator: null });
    expect(ai.status).toBe("not_configured");
    expect(result.proposal.source).toBe("deterministic");
    expect(result.proposal.sessions).toHaveLength(3);
    expect(validateSchedule(result.proposal.sessions, base)).toEqual([]);
  });
});

describe("Case I: AI provider failure and invalid output", () => {
  const deterministic = planWeek(base).proposal;
  const generatorReturning = (fn: () => Promise<unknown>) => {
    const generateStructured = vi.fn(async () => ({
      result: await fn(),
      meta: { provider: "fake", model: "fake", inputTokens: null, outputTokens: null, latencyMs: 1 },
    }));
    return { generateStructured } as unknown as StructuredGenerator & { generateStructured: typeof generateStructured };
  };

  it.each(["timeout", "auth", "malformed", "invalid_output"] as const)(
    "falls back on %s after exactly one attempt",
    async (kind) => {
      const generator = generatorReturning(async () => {
        throw new AiProviderError(kind, "x");
      });
      const { result, ai } = await generateProposal({ ...base, generator });
      expect(generator.generateStructured).toHaveBeenCalledTimes(1);
      expect(ai).toMatchObject({ status: "failed", kind });
      expect(ai.message).toMatch(/standard plan/);
      expect(result.proposal).toEqual(deterministic);
    },
  );

  const suggestion = (sessions: AiScheduleSuggestion["sessions"]): AiScheduleSuggestion => ({
    sessions,
    summary: "Mornings before class.",
    alternatives: ["Add a Sunday window."],
  });

  it("rejects AI output that puts a session in busy time", async () => {
    const generator = generatorReturning(async () =>
      suggestion(
        deterministic.sessions.map((s, i) => ({ ...s, startTime: i === 0 ? "10:00" : s.startTime, note: "ok" })),
      ),
    );
    const { result, ai } = await generateProposal({ ...base, generator });
    expect(ai.status).toBe("rejected");
    expect(ai.message).toMatch(/broke a scheduling rule/);
    expect(result.proposal).toEqual(deterministic);
  });

  it("rejects AI output with invented sessions, dropped sessions or back-to-back hard days", async () => {
    const cases = [
      suggestion([
        ...deterministic.sessions.map((s) => ({ ...s, note: "" })),
        { key: "zz", weekday: 7, startTime: "07:00", durationMinutes: 20, note: "" },
      ]),
      suggestion(deterministic.sessions.slice(1).map((s) => ({ ...s, note: "" }))),
      suggestion(deterministic.sessions.map((s, i) => ({ ...s, weekday: i + 1, note: "" }))),
      suggestion(deterministic.sessions.map((s) => ({ ...s, durationMinutes: 10, note: "" }))),
    ];
    for (const c of cases) {
      const { result, ai } = await generateProposal({ ...base, generator: generatorReturning(async () => c) });
      expect(ai.status).toBe("rejected");
      expect(result.proposal.source).toBe("deterministic");
      expect(validateSchedule(result.proposal.sessions, base)).toEqual([]);
    }
  });

  it("uses a valid AI arrangement, keeps app-generated facts, and marks it as AI-assisted", async () => {
    const generator = generatorReturning(async () =>
      // Weekday evenings are free in `normalWeek`; weekends only have mornings.
      suggestion(
        deterministic.sessions.map((s) => ({
          ...s,
          startTime: s.weekday <= 5 ? "18:00" : s.startTime,
          note: "Evenings are quieter.",
        })),
      ),
    );
    const { result, ai } = await generateProposal({
      ...base,
      settings: settings({ preferredTimesOfDay: [] }),
      generator,
    });
    expect(ai.status).toBe("used");
    expect(result.proposal.source).toBe("ai_assisted");
    expect(result.proposal.sessions.filter((s) => s.weekday <= 5).every((s) => s.startTime === "18:00")).toBe(true);
    expect(result.proposal.sessions[0].rationale[0]).toMatch(/free time on/);
    expect(result.proposal.sessions[0].rationale.at(-1)).toBe("AI note: Evenings are quieter.");
    expect(validateSchedule(result.proposal.sessions, base)).toEqual([]);
  });
});
