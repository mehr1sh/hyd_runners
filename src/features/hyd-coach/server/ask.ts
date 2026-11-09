import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env.server";
import { AiProviderError, getAiProvider, isStructuredGenerator, type StructuredGenerator } from "@/lib/ai";
import { aiCallsInLastDay, recordAiCall } from "@/features/scheduler/server/data";
import { answerQuestion, safetyAnswer } from "../logic/compose";
import { detectIntent } from "../logic/intent";
import { checkGrounding, factSheet, PhrasedAnswer, PHRASING_SYSTEM_PROMPT } from "../logic/grounding";
import type { CoachAnswer } from "../logic/types";
import { loadCoachData } from "./context";

export type StoredAnswer = CoachAnswer & { source: "deterministic" | "ai_assisted" | "safety"; aiNote: string | null };

/** Output cap for the phrasing call: a short answer, so cost per question stays small. */
const MAX_OUTPUT_TOKENS = 600;
const AI_TIMEOUT_NOTE = "Written from your data without AI phrasing.";

async function coachGenerator(supabase: SupabaseClient): Promise<StructuredGenerator | null> {
  const provider = getAiProvider();
  if (!provider || !isStructuredGenerator(provider)) return null;
  try {
    if ((await aiCallsInLastDay(supabase)) >= serverEnv.AI_DAILY_CALL_LIMIT) return null;
  } catch {
    return null; // usage unknown: fail closed
  }
  return provider;
}

/**
 * Answers a question from the caller's own data. The deterministic answer is
 * always computed first; an AI provider (when configured and within the daily
 * limit) may only rephrase it, and its reply is discarded unless it passes
 * the grounding check. Safety questions never reach a provider.
 */
export async function composeAnswer(
  supabase: SupabaseClient,
  userId: string,
  question: string,
  generator?: StructuredGenerator | null,
): Promise<StoredAnswer> {
  const intent = detectIntent(question);
  const data = await loadCoachData(supabase, userId, intent);
  if (intent === "safety") return { ...safetyAnswer(data), source: "safety", aiNote: null };
  const draft = answerQuestion(question, data);
  const gen = generator === undefined ? await coachGenerator(supabase) : generator;
  if (!gen || draft.basis.length === 0) return { ...draft, source: "deterministic", aiNote: null };

  try {
    const { result, meta } = await gen.generateStructured(PhrasedAnswer, {
      system: PHRASING_SYSTEM_PROMPT,
      text: factSheet(question, draft),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const grounding = checkGrounding(question, draft, result);
    await recordAiCall(supabase, {
      feature: "hyd_coach",
      outcome: grounding.ok ? "success" : "rejected",
      errorKind: grounding.ok ? null : grounding.reason,
      latencyMs: meta.latencyMs,
      model: meta.model,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
    });
    if (!grounding.ok) return { ...draft, source: "deterministic", aiNote: AI_TIMEOUT_NOTE };
    const used = new Set(result.usedFactIds);
    return {
      ...draft,
      text: result.answer,
      uncertainty: result.uncertainty || draft.uncertainty,
      // Keep every fact visible, the ones the model relied on first.
      basis: [...draft.basis.filter((f) => used.has(f.id)), ...draft.basis.filter((f) => !used.has(f.id))],
      source: "ai_assisted",
      aiNote: null,
    };
  } catch (error) {
    const kind = error instanceof AiProviderError ? error.kind : "network";
    await recordAiCall(supabase, { feature: "hyd_coach", outcome: "failed", errorKind: kind });
    return { ...draft, source: "deterministic", aiNote: AI_TIMEOUT_NOTE };
  }
}

export function conversationTitle(question: string) {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t : `${t.slice(0, 57)}…`;
}
