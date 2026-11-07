import { TriangleAlert } from "lucide-react";

/**
 * Shown to a signed-in runner when the database behind the app is not ready
 * (its schema has not been deployed). Sign-in worked; their data cannot load.
 */
export function DashboardUnavailableNotice() {
  return (
    <div
      role="status"
      className="flex gap-3 rounded-lg border border-brand-red/40 bg-brand-red-soft px-4 py-3 text-sm text-brand-navy"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-red-strong" aria-hidden />
      <p>
        <span className="font-semibold">Your dashboard is not available yet.</span> You are signed in, but HYD Runners
        is still being set up, so your workouts, programmes and rewards cannot load. Please try again later, and let a
        coach know if this keeps happening.
      </p>
    </div>
  );
}
