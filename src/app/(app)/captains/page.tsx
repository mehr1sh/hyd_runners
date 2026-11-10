import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Run captains" };

export default async function CaptainsPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Run captains"
      description="The runners who captain and sweep HYD Runners group runs, with the runs they've led."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the captains network" />
      </>
    );
  const { data } = await ctx.supabase.rpc("captains_network");
  const list = (data ?? []) as {
    user_id: string;
    display_name: string;
    runs_led: number;
    upcoming: number;
    verified: boolean;
  }[];
  return (
    <>
      {header}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No captains yet.</p>
      ) : (
        <ul aria-label="Captains" className="max-w-2xl divide-y rounded-xl border bg-card text-sm">
          {list.map((c) => (
            <li key={c.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="font-medium">{c.display_name}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {c.runs_led} run{c.runs_led === 1 ? "" : "s"} led · {c.upcoming} coming up
                {c.verified && <VerificationBadge status="verified" />}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">
        &ldquo;Verified&rdquo; appears only for captains whose run-captain profile an administrator has checked. Counts
        come from published events where they were captain or sweeper.
      </p>
    </>
  );
}
