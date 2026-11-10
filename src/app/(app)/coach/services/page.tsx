import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { myProfessionalProfile } from "@/features/coach-platform/queries";
import { formatDateTime } from "@/features/dashboard/format";
import { localDate } from "@/features/gamification/logic/time";
import { BookingAction, ServiceForm, SlotForm } from "@/features/marketplace/components/forms";
import { BOOKING_STATUS, SERVICE_KINDS, type ServiceKind } from "@/features/marketplace/logic";
import { myBookings } from "@/features/marketplace/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Services and bookings" };

export default async function ServicesPage() {
  const access = await requireRole(["coach", "mentor", "programme_manager", "admin"]);
  if (!access.allowed || !access.user) return <AccessDenied area="The coach area" />;
  const supabase = await createClient();
  const uid = access.user.id;
  const [profile, services, slots, bookings] = await Promise.all([
    myProfessionalProfile(supabase, uid),
    supabase
      .from("professional_services")
      .select("id, kind, title, duration_minutes, active")
      .eq("professional_id", uid),
    supabase
      .from("professional_slots")
      .select("id, starts_at, status, location_note")
      .eq("professional_id", uid)
      .gte("starts_at", new Date(Date.parse(new Date().toISOString()) - 86_400_000).toISOString())
      .order("starts_at"),
    myBookings(supabase),
  ]);
  const tz = "Asia/Kolkata";
  const incoming = bookings.filter((b) => b.professionalId === uid);
  return (
    <>
      <PageHeader
        title="Services and bookings"
        description="List what you offer, add open times and respond to requests. Payments are not handled by HYD Runners."
      />
      {!profile ? (
        <p className="rounded-xl border bg-card p-4 text-sm">
          Create your{" "}
          <Link href="/coach/profile" className="underline underline-offset-4">
            professional profile
          </Link>{" "}
          first.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="req-h" className="space-y-2 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="req-h" className="font-semibold text-brand-navy">
                Booking requests
              </h2>
              <VerificationBadge status={profile.verificationStatus} />
              {profile.verificationStatus !== "verified" && (
                <span className="text-sm text-muted-foreground">
                  Runners can book you once you&apos;re verified and listed.
                </span>
              )}
            </div>
            <ul className="space-y-2" aria-label="Booking requests">
              {incoming.map((b) => (
                <li key={b.id} className="space-y-1 rounded-xl border bg-card p-3 text-sm">
                  <p>
                    <span className="font-medium">{b.runnerName}</span> · {b.serviceTitle} ·{" "}
                    {formatDateTime(b.startsAt, tz)} <Badge variant="outline">{BOOKING_STATUS[b.status]}</Badge>
                  </p>
                  {b.note && <p className="text-muted-foreground">&ldquo;{b.note}&rdquo;</p>}
                  <div className="flex flex-wrap gap-2">
                    {b.status === "requested" && (
                      <>
                        <BookingAction id={b.id} action="confirm" label="Confirm" withNote variant="default" />
                        <BookingAction id={b.id} action="decline" label="Decline" />
                      </>
                    )}
                    {b.status === "confirmed" && Date.parse(b.endsAt) < Date.parse(new Date().toISOString()) && (
                      <BookingAction id={b.id} action="complete" label="Mark completed" />
                    )}
                    {(b.status === "requested" || b.status === "confirmed") &&
                      Date.parse(b.startsAt) > Date.parse(new Date().toISOString()) && (
                        <BookingAction id={b.id} action="cancel" label="Cancel" variant="ghost" />
                      )}
                  </div>
                </li>
              ))}
              {incoming.length === 0 && <li className="text-sm text-muted-foreground">No requests yet.</li>}
            </ul>
          </section>
          <section aria-labelledby="svc-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="svc-h" className="font-semibold text-brand-navy">
              Your services
            </h2>
            <ul className="text-sm">
              {((services.data ?? []) as { id: string; kind: string; title: string; duration_minutes: number }[]).map(
                (s) => (
                  <li key={s.id}>
                    {s.title} · {SERVICE_KINDS[s.kind as ServiceKind]} · {s.duration_minutes} min
                  </li>
                ),
              )}
            </ul>
            <ServiceForm />
          </section>
          <section aria-labelledby="slot-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="slot-h" className="font-semibold text-brand-navy">
              Open times
            </h2>
            <ul className="text-sm">
              {(
                (slots.data ?? []) as { id: string; starts_at: string; status: string; location_note: string | null }[]
              ).map((s) => (
                <li key={s.id}>
                  {formatDateTime(s.starts_at, tz)} · {s.status}
                  {s.location_note ? ` · ${s.location_note}` : ""}
                </li>
              ))}
            </ul>
            <SlotForm today={localDate(new Date(), tz)} />
          </section>
        </div>
      )}
    </>
  );
}
