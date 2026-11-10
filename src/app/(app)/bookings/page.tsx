import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BookingAction } from "@/features/marketplace/components/forms";
import { BOOKING_STATUS, disabledPayments } from "@/features/marketplace/logic";
import { myBookings } from "@/features/marketplace/queries";

export const metadata: Metadata = { title: "Your bookings" };

export default async function BookingsPage() {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Your bookings" description={disabledPayments.describe()} />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="bookings" />
      </>
    );
  const bookings = (await myBookings(ctx.supabase)).filter((b) => b.runnerId === ctx.user.id);
  return (
    <>
      {header}
      {bookings.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No bookings yet"
          description="Find a verified coach or physio to book a session."
        />
      ) : (
        <ul className="max-w-3xl space-y-2" aria-label="Bookings">
          {bookings.map((b) => (
            <li key={b.id} className="space-y-1 rounded-xl border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.serviceTitle}</span>
                <Badge variant={b.status === "confirmed" ? "default" : "outline"}>{BOOKING_STATUS[b.status]}</Badge>
              </div>
              <p>
                with{" "}
                <Link href={`/professionals/${b.professionalId}`} className="underline underline-offset-4">
                  {b.professionalName}
                </Link>{" "}
                · {formatDateTime(b.startsAt, ctx.timezone)}
                {b.locationNote ? ` · ${b.locationNote}` : ""}
              </p>
              {b.responseNote && <p className="text-muted-foreground">Message: {b.responseNote}</p>}
              {(b.status === "requested" || b.status === "confirmed") &&
                Date.parse(b.startsAt) > Date.parse(new Date().toISOString()) && (
                  <BookingAction id={b.id} action="cancel" label="Cancel booking" variant="ghost" />
                )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm">
        <Link href="/professionals" className="underline underline-offset-4">
          Find coaches and physios
        </Link>
      </p>
    </>
  );
}
