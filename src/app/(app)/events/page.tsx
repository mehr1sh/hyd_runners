import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { listUpcomingEvents } from "@/features/community/queries";

export const metadata: Metadata = { title: "Events" };

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function EventsPage() {
  const events = await listUpcomingEvents();

  return (
    <>
      <PageHeader title="Events" description="Group runs and meet-ups. Beginners welcome at every one." />
      <div className="space-y-6">
        <PlaceholderNotice feature="events and RSVPs" owner="Community">
          Events are read from the database; RSVPs are not available yet.
        </PlaceholderNotice>
        {events.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No upcoming events" description="New events will be listed here." />
        ) : (
          <ul className="grid gap-3">
            {events.map((e) => (
              <li key={e.id} className="rounded-xl border bg-card p-4">
                <p className="text-sm font-medium text-brand-red-strong">
                  <time dateTime={e.startsAt}>{dateFormat.format(new Date(e.startsAt))}</time>
                </p>
                <h2 className="font-semibold text-brand-navy">{e.title}</h2>
                {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
