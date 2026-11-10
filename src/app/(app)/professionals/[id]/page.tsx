import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BookingForm } from "@/features/marketplace/components/forms";
import { SERVICE_KINDS, type ServiceKind } from "@/features/marketplace/logic";
import { myBookings, professionalPage } from "@/features/marketplace/queries";
import { BOOKING_STATUS } from "@/features/marketplace/logic";

export const metadata: Metadata = { title: "Professional" };

export default async function ProfessionalPage({ params }: PageProps<"/professionals/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="the professional directory" />;
  const page = await professionalPage(ctx.supabase, id);
  if (!page) notFound();
  const own = id === ctx.user.id;
  const mine = (await myBookings(ctx.supabase)).filter(
    (b) =>
      b.professionalId === id && b.runnerId === ctx.user.id && (b.status === "requested" || b.status === "confirmed"),
  );
  return (
    <>
      <PageHeader title={page.entry.display_name} description={page.entry.headline ?? "Verified professional"} />
      <p className="mb-4 text-sm">
        <Link href="/professionals" className="underline underline-offset-4">
          All coaches and physios
        </Link>
      </p>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <VerificationBadge status="verified" />
            {page.entry.verified_at && (
              <span className="text-muted-foreground">Credentials checked {page.entry.verified_at.slice(0, 10)}</span>
            )}
          </div>
          {page.bio && <p className="text-sm whitespace-pre-line">{page.bio}</p>}
          {page.credentials.length > 0 && (
            <section aria-labelledby="cred-h" className="space-y-1 text-sm">
              <h2 id="cred-h" className="font-semibold text-brand-navy">
                Credentials
              </h2>
              <ul className="list-disc pl-5">
                {page.credentials.map((c, i) => (
                  <li key={i}>
                    {c.name}
                    {c.issuer && `, ${c.issuer}`}
                    {c.year && ` (${c.year})`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="svc-h" className="space-y-2">
            <h2 id="svc-h" className="font-semibold text-brand-navy">
              Services
            </h2>
            <ul className="space-y-2">
              {page.services.map((s) => (
                <li key={s.id} className="rounded-xl border bg-card p-3 text-sm">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-muted-foreground">
                    {SERVICE_KINDS[s.kind as ServiceKind]} · {s.duration_minutes} min ·{" "}
                    {s.delivery === "online" ? "Online" : "In person"}
                    {s.indicative_price_inr !== null ? ` · about ₹${s.indicative_price_inr}, paid directly` : ""}
                  </p>
                  {s.description && <p>{s.description}</p>}
                </li>
              ))}
            </ul>
          </section>
          <p className="text-xs text-muted-foreground">
            Concerned about this professional? Tell the HYD Runners team under{" "}
            <Link href="/community" className="underline underline-offset-4">
              Community → Feedback
            </Link>
            .
          </p>
        </div>
        <aside className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold text-brand-navy">Book a session</h2>
          {mine.length > 0 && (
            <div role="status" className="mb-3 rounded-md bg-muted/50 p-2 text-sm">
              {mine.map((b) => (
                <p key={b.id}>
                  {b.serviceTitle}, {formatDateTime(b.startsAt, ctx.timezone)}: {BOOKING_STATUS[b.status]}
                </p>
              ))}
              <Link href="/bookings" className="underline underline-offset-4">
                Your bookings
              </Link>
            </div>
          )}
          {own ? (
            <p className="text-sm text-muted-foreground">This is your listing.</p>
          ) : (
            <BookingForm
              services={page.services.map((s) => ({ id: s.id, label: `${s.title} (${s.duration_minutes} min)` }))}
              slots={page.slots.map((s) => ({
                id: s.id,
                label: `${formatDateTime(s.starts_at, ctx.timezone)}${s.location_note ? ` · ${s.location_note}` : ""}`,
              }))}
            />
          )}
        </aside>
      </div>
    </>
  );
}
