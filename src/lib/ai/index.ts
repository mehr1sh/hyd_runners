import "server-only";
import { serverEnv } from "@/lib/env.server";
import type { AiProvider } from "./provider";

export * from "./provider";

/**
 * Returns the configured AI provider, or null when AI is switched off
 * (`AI_PROVIDER=none`) or no key is present. Callers MUST fall back to the
 * deterministic path on null.
 *
 * The Anthropic adapter (Claude structured outputs + Zod) is added by the
 * scheduler feature owner in `src/lib/ai/anthropic.ts`; until then this
 * always returns null so the fallback path is exercised from day one.
 */
export function getAiProvider(): AiProvider | null {
  if (serverEnv.AI_PROVIDER === "none" || !serverEnv.ANTHROPIC_API_KEY) return null;
  // TODO(scheduler owner): return createAnthropicProvider(serverEnv) from ./anthropic.ts.
  return null;
}
