import type { Metadata } from "next";
import Link from "next/link";
import { UserSearch } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BOUNDARIES } from "@/features/marketplace/logic";
import { directory } from "@/features/marketplace/queries";

export const metadata: Metadata = { title: "Coaches and physios" };

const PROFESSION = {
  running_coach: "Running coach",
  strength_coach: "Strength coach",
  physiotherapist: "Physiotherapist",
  nutritionist: "Nutritionist",
  run_captain: "Run captain",
} as const;

export default async function ProfessionalsPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Coaches and physios"
      description="Professionals whose credentials an administrator has checked. Book a session; fees, if any, are agreed directly."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the professional directory" />
      </>
    );
  const pros = await directory(ctx.supabase);
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {pros.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="No verified professionals yet"
            description="Professionals appear here once their credentials are verified."
          />
        ) : (
          <ul className="space-y-2" aria-label="Professionals">
            {pros.map((p) => (
              <li key={p.user_id} className="space-y-1 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/professionals/${p.user_id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {p.display_name}
                  </Link>
                  <VerificationBadge status="verified" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {PROFESSION[p.profession as keyof typeof PROFESSION] ?? p.profession}
                  {p.experience_years !== null ? ` · ${p.experience_years} years` : ""} · {p.services} service
                  {p.services === 1 ? "" : "s"}
                </p>
                {p.headline && <p className="text-sm">{p.headline}</p>}
              </li>
            ))}
          </ul>
        )}
        <aside className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <h2 className="font-semibold text-brand-navy">Good to know</h2>
          <ul className="list-disc pl-5">
            {BOUNDARIES.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p>
            <Link href="/bookings" className="underline underline-offset-4">
              Your bookings
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
