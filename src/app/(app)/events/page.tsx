import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, MapPin, Users } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RsvpButton } from "@/features/community/components/rsvp-button";
import { getAttendance, getMyRsvps, listLocations, listUpcomingEvents } from "@/features/community/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Events" description="Group runs and meet-ups. Beginners welcome at every one." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="events" />
      </>
    );

  const sp = await searchParams;
  const locationFilter = z.uuid().safeParse(sp.location);
  const [events, locations] = await Promise.all([listUpcomingEvents(50), listLocations()]);
  const visible = locationFilter.success ? events.filter((e) => e.locationId === locationFilter.data) : events;
  const [attendance, mine] = await Promise.all([getAttendance(visible.map((e) => e.id)), getMyRsvps(ctx.user.id)]);
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const filterName = locationFilter.success ? locationById.get(locationFilter.data)?.name : null;

  return (
    <>
      {header}
      <div className="space-y-6">
        {filterName && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Showing events at <span className="font-medium text-brand-navy">{filterName}</span>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/events">Show all</Link>
            </Button>
          </p>
        )}
        {visible.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No upcoming events"
            description="New community runs will be listed here."
            action={
              <Button asChild variant="outline">
                <Link href="/map">Explore places to run</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3">
            {visible.map((e) => {
              const loc = e.locationId ? locationById.get(e.locationId) : null;
              const going = attendance.get(e.id) ?? 0;
              const isGoing = mine.get(e.id) === "going";
              const full = e.capacity !== null && going >= e.capacity;
              const sample = e.title.toLowerCase().startsWith("sample");
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-brand-red-strong">
                      <time dateTime={e.startsAt}>{formatDateTime(e.startsAt, ctx.timezone)}</time>
                    </p>
                    <h2 className="flex flex-wrap items-center gap-2 font-semibold text-brand-navy">
                      {e.title} {sample && <Badge variant="outline">Sample event</Badge>}
                    </h2>
                    {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {loc && (
                        <Link
                          href={`/map?location=${loc.id}`}
                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        >
                          <MapPin className="size-3.5" aria-hidden /> {loc.name}
                        </Link>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden /> {going} going{e.capacity ? ` of ${e.capacity}` : ""}
                      </span>
                      {isGoing && <Badge>You&apos;re going</Badge>}
                    </p>
                  </div>
                  <RsvpButton eventId={e.id} going={isGoing} full={full} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
