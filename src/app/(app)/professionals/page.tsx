import type { Metadata } from "next";
import Link from "next/link";
import { UserSearch } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BOUNDARIES } from "@/features/marketplace/logic";
import { directory, sampleProfessionals } from "@/features/marketplace/queries";
import { Badge } from "@/components/ui/badge";

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
  const [pros, samples] = await Promise.all([directory(ctx.supabase), sampleProfessionals(ctx.supabase)]);
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {pros.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="No verified professionals yet"
            description="Coaches, physiotherapists and other professionals appear here once an administrator has checked their credentials. Professionals can apply from their coach profile."
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
        {samples.length > 0 && (
          <section aria-labelledby="sample-pros" className="space-y-2 lg:col-start-1">
            <h2 id="sample-pros" className="font-semibold text-brand-navy">
              Sample profiles
            </h2>
            <p className="text-sm text-muted-foreground">
              Demo data for exploring the app. These are not real people, their credentials have not been checked, and
              they can&apos;t be booked.
            </p>
            <ul className="space-y-2" aria-label="Sample profiles">
              {samples.map((p) => (
                <li key={p.user_id} className="space-y-1 rounded-xl border border-dashed bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.display_name}</span>
                    <Badge variant="outline">Sample profile</Badge>
                    <VerificationBadge status={p.verification_status} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {PROFESSION[p.profession as keyof typeof PROFESSION] ?? p.profession}
                    {p.experience_years !== null ? ` · ${p.experience_years} years` : ""}
                    {p.specializations.length > 0 ? ` · ${p.specializations.join(", ")}` : ""}
                  </p>
                  {p.headline && <p className="text-sm">{p.headline}</p>}
                  {p.services.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {p.services.map((s) => (
                        <li key={s.title}>
                          {s.title} · {s.durationMinutes} min · {s.delivery === "online" ? "Online" : "In person"}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <aside className="space-y-2 rounded-xl border bg-card p-4 text-sm lg:col-start-2 lg:row-start-1">
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
