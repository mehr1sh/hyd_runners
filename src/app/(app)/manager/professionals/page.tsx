import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ReviewForm } from "@/features/coach-platform/components/forms";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { PROFESSIONAL_COLUMNS, toProfessional } from "@/features/coach-platform/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Professional verification" };

export default async function ProfessionalsPage() {
  const access = await requireRole(["admin"]);
  if (!access.allowed) return <AccessDenied area="Professional verification" />;
  const supabase = await createClient();
  const { data } = await supabase
    .from("professional_profiles")
    .select(PROFESSIONAL_COLUMNS)
    .order("verification_status")
    .order("updated_at", { ascending: false })
    .limit(100);
  const profiles = ((data ?? []) as Record<string, unknown>[]).map(toProfessional);
  const pending = profiles.filter((p) => p.verificationStatus === "pending");
  const others = profiles.filter((p) => p.verificationStatus !== "pending");
  const card = (p: (typeof profiles)[number]) => (
    <li key={p.userId} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.displayName ?? "Unnamed"}</span>
        <span className="text-muted-foreground">{p.profession.replace("_", " ")}</span>
        <VerificationBadge status={p.verificationStatus} />
      </div>
      {p.headline && <p>{p.headline}</p>}
      <ul className="list-disc pl-5">
        {p.credentials.map((c, i) => (
          <li key={i}>
            {c.name}
            {c.issuer && `, ${c.issuer}`}
            {c.year && ` (${c.year})`}
            {c.reference && ` · ref ${c.reference}`}
          </li>
        ))}
      </ul>
      <ReviewForm userId={p.userId} />
    </li>
  );
  return (
    <>
      <PageHeader
        title="Professional verification"
        description="Check each credential with the issuing body before verifying. Record how you checked it; the decision is audited and the professional is notified."
      />
      <div className="space-y-6">
        <section aria-labelledby="pending-h" className="space-y-2">
          <h2 id="pending-h" className="font-semibold text-brand-navy">
            Waiting for review ({pending.length})
          </h2>
          <ul className="space-y-3">{pending.map(card)}</ul>
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        </section>
        <section aria-labelledby="all-h" className="space-y-2">
          <h2 id="all-h" className="font-semibold text-brand-navy">
            All profiles
          </h2>
          <ul className="space-y-3">{others.map(card)}</ul>
        </section>
      </div>
    </>
  );
}
