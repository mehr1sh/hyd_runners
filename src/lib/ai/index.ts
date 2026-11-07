import "server-only";
import { serverEnv } from "@/lib/env.server";
import { createGeminiProvider } from "./gemini";
import type { AiProvider } from "./provider";

export * from "./provider";
export * from "./structured";

/**
 * Returns the configured AI provider, or null when AI is switched off
 * (`AI_PROVIDER=none`) or no key is present. Callers MUST fall back to the
 * deterministic path on null.
 *
 * Gemini (`AI_PROVIDER=gemini` + `GEMINI_API_KEY`) is implemented in
 * ./gemini.ts. No Anthropic adapter exists yet, so `anthropic` still returns
 * null and the fallback path is used.
 */
export function getAiProvider(): AiProvider | null {
  if (serverEnv.AI_PROVIDER === "gemini" && serverEnv.GEMINI_API_KEY) {
    return createGeminiProvider({ apiKey: serverEnv.GEMINI_API_KEY, model: serverEnv.GEMINI_MODEL });
  }
  return null;
}
