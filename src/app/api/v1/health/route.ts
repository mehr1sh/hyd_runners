import { ok } from "@/lib/api/response";
import { API_VERSION } from "@/lib/contracts";
import { isSupabaseConfigured } from "@/lib/env";

export function GET() {
  return ok({ status: "ok", apiVersion: API_VERSION, supabaseConfigured: isSupabaseConfigured });
}
