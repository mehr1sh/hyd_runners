import { fail, ok } from "@/lib/api/response";
import { isSupabaseConfigured } from "@/lib/env";
import { seedDemoData } from "@/features/dashboard/demo-seed";

/**
 * POST /api/v1/dev/seed-demo — create or reset the labelled demo accounts.
 * Always allowed in development. In production it requires
 * `Authorization: Bearer <DEMO_SEED_TOKEN>` and is disabled when that
 * variable is unset.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured) return fail("internal_error", "Supabase is not configured.");
  if (process.env.NODE_ENV === "production") {
    const token = process.env.DEMO_SEED_TOKEN;
    if (!token) return fail("not_found", "Not found.");
    if (request.headers.get("authorization") !== `Bearer ${token}`) return fail("forbidden", "Invalid seed token.");
  }
  try {
    return ok(await seedDemoData(), { status: 201 });
  } catch (e) {
    console.error(e);
    return fail("internal_error", e instanceof Error ? e.message : "Seeding failed.");
  }
}
