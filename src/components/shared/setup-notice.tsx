import { TriangleAlert } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";

/** Shown in preview mode, when the app runs without Supabase credentials. */
export function SetupNotice() {
  if (isSupabaseConfigured) return null;
  return (
    <div role="status" className="border-b bg-brand-red-soft px-4 py-2 text-center text-sm text-brand-navy">
      <TriangleAlert className="mr-1.5 inline size-4 align-[-3px] text-brand-red-strong" aria-hidden />
      Preview mode: Supabase is not configured, so sign-in and data are disabled. See README → Environment variables.
    </div>
  );
}
