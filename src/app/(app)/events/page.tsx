import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronRight, MapPin, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listLocations } from "@/features/community/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { RsvpControl } from "@/features/events/components/event-controls";
import { EVENT_CATEGORY_LABEL, filterHref, parseEventFilters, type EventCategory } from "@/features/events/logic";
import { attendanceFor, listEvents, myRsvpsFor } from "@/features/events/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader title="Events" description="Group runs, races and meet-ups across Hyderabad. Beginners welcome." />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="events" />
      </>
    );

  const filters = parseEventFilters(await searchParams);
  const [{ events, nextCursor, now }, locations] = await Promise.all([
    listEvents(ctx.supabase, filters),
    listLocations(),
  ]);
  const ids = events.map((e) => e.id);
  const [attendance, mine] = await Promise.all([
    attendanceFor(ctx.supabase, ids),
    myRsvpsFor(ctx.supabase, ctx.user.id, ids),
  ]);
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const filterName = filters.locationId ? locationById.get(filters.locationId)?.name : null;
  const past = filters.when === "past";

  return (
    <>
      {header}
      <div className="space-y-6">
        <nav aria-label="Event filters" className="space-y-3">
          <div className="flex gap-2" role="tablist" aria-label="When">
            {(["upcoming", "past"] as const).map((when) => (
              <Link
                key={when}
                role="tab"
                aria-selected={filters.when === when}
                href={filterHref(filters, { when })}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  filters.when === when ? "border-brand-navy bg-brand-navy text-white" : "text-brand-navy",
                )}
              >
                {when === "upcoming" ? "Upcoming" : "Past events"}
              </Link>
            ))}
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Category">
            <Link
              href={filterHref(filters, { category: null })}
              aria-current={filters.category === null ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-sm",
                filters.category === null ? "border-brand-red bg-brand-red-soft font-medium" : "",
              )}
            >
              All
            </Link>
            {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((c) => (
              <Link
                key={c}
                href={filterHref(filters, { category: c })}
                aria-current={filters.category === c ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-sm",
                  filters.category === c ? "border-brand-red bg-brand-red-soft font-medium" : "",
                )}
              >
                {EVENT_CATEGORY_LABEL[c]}
              </Link>
            ))}
          </div>
          {filterName && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              At <span className="font-medium text-brand-navy">{filterName}</span>
              <Button asChild variant="link" size="sm" className="px-0">
                <Link href={filterHref(filters, { locationId: null })}>Any place</Link>
              </Button>
            </p>
          )}
        </nav>

        {events.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={past ? "No past events here" : "No upcoming events here"}
            description={
              filters.category || filters.locationId
                ? "Try another category or place."
                : past
                  ? "Events you can look back on will appear here."
                  : "New community runs will be listed here."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/map">Explore places to run</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3">
            {events.map((e) => {
              const loc = e.locationId ? locationById.get(e.locationId) : null;
              const counts = attendance.get(e.id) ?? { going: 0, waitlisted: 0 };
              const my = mine.get(e.id) ?? null;
              const full = e.capacity !== null && counts.going >= e.capacity;
              const open = !past && (!e.registrationClosesAt || new Date(e.registrationClosesAt).getTime() > now);
              const sample = e.title.toLowerCase().startsWith("sample");
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-brand-red-strong">
                      <time dateTime={e.startsAt}>{formatDateTime(e.startsAt, ctx.timezone)}</time>
                    </p>
                    <h2 className="flex flex-wrap items-center gap-2 font-semibold text-brand-navy">
                      <Link href={`/events/${e.id}`} className="underline-offset-4 hover:underline">
                        {e.title}
                      </Link>
                      <Badge variant="secondary">{EVENT_CATEGORY_LABEL[e.category]}</Badge>
                      {sample && <Badge variant="outline">Sample event</Badge>}
                    </h2>
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {loc && (
                        <Link
                          href={filterHref(filters, { locationId: loc.id })}
                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        >
                          <MapPin className="size-3.5" aria-hidden /> {loc.name}
                        </Link>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden /> {counts.going} {past ? "went" : "going"}
                        {e.capacity ? ` of ${e.capacity}` : ""}
                        {counts.waitlisted > 0 ? ` · ${counts.waitlisted} waiting` : ""}
                      </span>
                      {my?.status === "going" && <Badge>{past ? "You went" : "You're going"}</Badge>}
                      {my?.status === "waitlisted" && <Badge variant="outline">On the waiting list</Badge>}
                    </p>
                    <Link
                      href={`/events/${e.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand-navy underline-offset-4 hover:underline"
                    >
                      Details <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                  {!past && (
                    <RsvpControl
                      eventId={e.id}
                      status={my?.status ?? null}
                      full={full}
                      open={open}
                      waitlistPosition={null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <Button asChild variant="outline">
            <Link href={filterHref(filters, { cursor: nextCursor })}>{past ? "Older events" : "Later events"}</Link>
          </Button>
        )}
      </div>
    </>
  );
}
