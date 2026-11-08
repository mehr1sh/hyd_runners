import { fail, ok } from "@/lib/api/response";
import { isSupabaseConfigured } from "@/lib/env";
import { demoSeedConfig } from "@/lib/env.server";
import { bearerToken, safeEqual } from "@/lib/security/compare";
import { seedDemoData } from "@/features/dashboard/demo-seed";

/**
 * POST /api/v1/dev/seed-demo — create or reset the labelled demo accounts.
 *
 * Fails closed in every environment, development included: it answers 404
 * unless `DEMO_SEED_ENABLED=true` and a `DEMO_SEED_TOKEN` of at least 32
 * characters are set, and always 404 on Vercel Production and Preview (they
 * share the production database). Callers send
 * `Authorization: Bearer <DEMO_SEED_TOKEN>`, compared in constant time.
 * The demo runner's password is generated for each run and returned only in
 * this response.
 */
export async function POST(request: Request) {
  const config = demoSeedConfig();
  if (!config.enabled) return fail("not_found", "Not found.");

  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !safeEqual(token, config.token)) {
    return fail("unauthenticated", "Missing or invalid seed token.");
  }
  if (!isSupabaseConfigured) return fail("internal_error", "Seeding is not available.");

  try {
    return ok(await seedDemoData(), { status: 201 });
  } catch (e) {
    console.error("[seed-demo] seeding failed", e);
    return fail("internal_error", "Seeding failed. See the server logs.");
  }
}
