import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a Client Component fails the
 * build (`server-only`), which keeps keys out of the browser bundle.
 */
const ServerEnv = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z.enum(["anthropic", "gemini", "none"]).default("none"),
  AI_MODEL: z.string().default("claude-haiku-5-5"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().min(0).default(10),
});

/**
 * True on Vercel Preview deployments. Preview shares the production Supabase
 * project, so features that create accounts or need the secret key are off.
 */
export const isPreviewDeployment = process.env.VERCEL_ENV === "preview";

export const DEMO_SEED_TOKEN_MIN_LENGTH = 32;

export type DemoSeedConfig = { enabled: true; token: string } | { enabled: false };

/**
 * POST /api/v1/dev/seed-demo fails closed. It is on only when
 * `DEMO_SEED_ENABLED=true` and `DEMO_SEED_TOKEN` holds at least
 * DEMO_SEED_TOKEN_MIN_LENGTH characters, and never on a Vercel Production or
 * Preview deployment (both use the shared production database), whatever the
 * variables say. Read per call so it always reflects the current environment.
 */
export function demoSeedConfig(env: NodeJS.ProcessEnv = process.env): DemoSeedConfig {
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return { enabled: false };
  if (env.DEMO_SEED_ENABLED !== "true") return { enabled: false };
  const token = env.DEMO_SEED_TOKEN?.trim() ?? "";
  if (token.length < DEMO_SEED_TOKEN_MIN_LENGTH) return { enabled: false };
  return { enabled: true, token };
}

export const serverEnv = ServerEnv.parse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || undefined,
  AI_PROVIDER: process.env.AI_PROVIDER || undefined,
  AI_MODEL: process.env.AI_MODEL || undefined,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
  GEMINI_MODEL: process.env.GEMINI_MODEL || undefined,
  AI_DAILY_CALL_LIMIT: process.env.AI_DAILY_CALL_LIMIT || undefined,
});
