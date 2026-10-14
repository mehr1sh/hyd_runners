import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a Client Component fails the
 * build (`server-only`), which keeps keys out of the browser bundle.
 */
const ServerEnv = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z.enum(["anthropic", "none"]).default("none"),
  AI_MODEL: z.string().default("claude-haiku-5-5"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().min(0).default(10),
});

export const serverEnv = ServerEnv.parse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || undefined,
  AI_PROVIDER: process.env.AI_PROVIDER || undefined,
  AI_MODEL: process.env.AI_MODEL || undefined,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
  AI_DAILY_CALL_LIMIT: process.env.AI_DAILY_CALL_LIMIT || undefined,
});
