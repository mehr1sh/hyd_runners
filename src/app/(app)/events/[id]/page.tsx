import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, MapPin, Megaphone, Settings, Users } from "lucide-react";
import { z } from "zod";
import { RouteMap } from "@/components/map/route-map";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { Countdown, PaceGroupPicker, RsvpControl } from "@/features/events/components/event-controls";
import {
  countdown,
  countdownLabel,
  EVENT_CATEGORY_LABEL,
  formatDuration,
  paceRangeLabel,
  TEAM_ROLE_LABEL,
} from "@/features/events/logic";
import { getEventDetail } from "@/features/events/queries";

import { groupRunRecap } from "@/features/live/queries";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Event" description="Sign in to see event details." />
        <RunnerPreviewNotice feature="events" />
      </>
    );

  const detail = await getEventDetail(ctx.supabase, id, ctx.user.id, ctx.user.roles);
  if (!detail) notFound();
  const { event, location, counts, mine, paceGroups } = detail;
  const mystery = (
    ((await ctx.supabase.rpc("mystery_route", { p_event: id })).data ?? []) as {
      revealed: boolean;
      reveal_at: string | null;
      slug: string | null;
      name: string | null;
      distance_m: number;
    }[]
  )[0];
  const recap = await groupRunRecap(ctx.supabase, id);
  const now = detail.now;
  const past = new Date(event.endsAt).getTime() <= now;
  const cancelled = event.status === "cancelled";
  const full = event.capacity !== null && counts.going >= event.capacity;
  const open =
    !past &&
    event.status === "published" &&
    (!event.registrationClosesAt || new Date(event.registrationClosesAt).getTime() > now);
  const active = mine?.status === "going" || mine?.status === "waitlisted";

  return (
    <>
      <PageHeader title={event.title} description={EVENT_CATEGORY_LABEL[event.category]} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="When and where">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{EVENT_CATEGORY_LABEL[event.category]}</Badge>
              {event.status === "draft" && <Badge variant="outline">Draft</Badge>}
              {cancelled && <Badge variant="destructive">Cancelled</Badge>}
              {past && !cancelled && <Badge variant="outline">Finished</Badge>}
              {event.title.toLowerCase().startsWith("sample") && <Badge variant="outline">Sample event</Badge>}
            </div>
            <p className="font-medium text-brand-navy">
              <time dateTime={event.startsAt}>{formatDateTime(event.startsAt, ctx.timezone)}</time> –{" "}
              <time dateTime={event.endsAt}>{formatDateTime(event.endsAt, ctx.timezone)}</time>
            </p>
            {!past && !cancelled && (
              <Countdown startsAt={event.startsAt} initial={countdownLabel(countdown(now, event.startsAt))} />
            )}
            {location && (
              <p className="flex items-start gap-1 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <Link href={`/map?location=${location.id}`} className="underline underline-offset-4">
                    {location.name}
                  </Link>
                  {location.address ? <span className="text-muted-foreground"> · {location.address}</span> : null}
                </span>
              </p>
            )}
            {event.meetingPoint && <p className="text-sm">Meeting point: {event.meetingPoint}</p>}
            {event.registrationClosesAt && !past && (
              <p className="text-sm text-muted-foreground">
                Registration closes {formatDateTime(event.registrationClosesAt, ctx.timezone)}
              </p>
            )}
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="size-4" aria-hidden /> {counts.going} {past ? "went" : "going"}
              {event.capacity ? ` of ${event.capacity}` : ""}
              {counts.waitlisted > 0 ? ` · ${counts.waitlisted} on the waiting list` : ""}
            </p>
            {event.description && <p className="text-sm whitespace-pre-wrap">{event.description}</p>}
            <div className="flex flex-wrap gap-2">
              {event.status === "published" && (
                <Button asChild variant="outline" size="sm">
                  <a href={`/events/${event.id}/calendar`} download>
                    <CalendarPlus className="size-4" aria-hidden /> Add to calendar
                  </a>
                </Button>
              )}
              {detail.canStaff && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/events/${event.id}/manage`}>
                    <Settings className="size-4" aria-hidden /> Manage event
                  </Link>
                </Button>
              )}
            </div>
          </section>

          {mystery && (
            <section
              className="space-y-1 rounded-xl border-2 border-dashed bg-card p-4 text-sm"
              aria-labelledby="mystery"
            >
              <h2 id="mystery" className="font-semibold text-brand-navy">
                Mystery run
              </h2>
              {mystery.revealed && mystery.slug ? (
                <p>
                  The route:{" "}
                  <Link href={`/routes/${mystery.slug}`} className="underline underline-offset-4">
                    {mystery.name}
                  </Link>{" "}
                  ({(Number(mystery.distance_m) / 1000).toFixed(1)} km)
                </p>
              ) : (
                <p>
                  The route is revealed {mystery.reveal_at ? formatDateTime(mystery.reveal_at, ctx.timezone) : "later"}.
                  It&apos;s about {(Number(mystery.distance_m) / 1000).toFixed(1)} km, a published HYD Runners route.
                </p>
              )}
              <p className="text-muted-foreground">
                The meeting point, organisers and safety details above stay the same.
              </p>
            </section>
          )}

          {detail.route && (
            <section className="space-y-2" aria-labelledby="event-route">
              <h2 id="event-route" className="font-semibold text-brand-navy">
                Route
              </h2>
              <p className="text-sm">
                <Link href={`/routes/${detail.route.slug}`} className="underline underline-offset-4">
                  {detail.route.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  · {(Number(detail.route.distance_m) / 1000).toFixed(2)} km{detail.route.is_loop ? " loop" : ""}
                </span>
              </p>
              {detail.route.route_geojson && (
                <RouteMap
                  label={`Map of ${detail.route.name}`}
                  className="h-[260px]"
                  lines={[
                    { id: event.id, name: detail.route.name, coordinates: detail.route.route_geojson.coordinates },
                  ]}
                />
              )}
            </section>
          )}

          {paceGroups.length > 0 && (
            <section className="space-y-2" aria-labelledby="pace-groups">
              <h2 id="pace-groups" className="font-semibold text-brand-navy">
                Pace groups
              </h2>
              <p className="text-sm text-muted-foreground">
                Groups regroup along the way and nobody is left behind. If you are unsure, choose the slower group.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {paceGroups.map((g) => (
                  <li key={g.id} className="rounded-xl border bg-card p-3 text-sm">
                    <p className="font-medium text-brand-navy">{g.label}</p>
                    <p className="text-muted-foreground">{paceRangeLabel(g.minPace, g.maxPace, g.runWalk)}</p>
                    {g.notes && <p className="mt-1">{g.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {past && recap && (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="recap">
              <h2 id="recap" className="font-semibold text-brand-navy">
                Group recap
              </h2>
              <p className="text-sm">
                {recap.checkedIn} checked in of {recap.going} going
                {recap.finished > 0 ? ` · ${recap.finished} finished` : ""}
                {recap.distanceM !== null && recap.activities !== null
                  ? ` · ${(recap.distanceM / 1000).toFixed(1)} km together across ${recap.activities} recorded runs`
                  : ""}
              </p>
              {recap.paceGroups.some((g) => g.checkedIn > 0) && (
                <p className="text-sm text-muted-foreground">
                  {recap.paceGroups
                    .filter((g) => g.checkedIn > 0)
                    .map((g) => `${g.label}: ${g.checkedIn}`)
                    .join(" · ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                From check-ins and the activities attendees imported or recorded. Group distance appears once at least
                three runs are recorded, so no one&apos;s run can be singled out.
              </p>
            </section>
          )}

          <section className="space-y-2" aria-labelledby="updates">
            <h2 id="updates" className="flex items-center gap-2 font-semibold text-brand-navy">
              <Megaphone className="size-4" aria-hidden /> Updates from the organisers
            </h2>
            {detail.updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              <ol className="space-y-2">
                {detail.updates.map((u) => (
                  <li key={u.id} className="rounded-xl border bg-card p-3 text-sm">
                    <p className="whitespace-pre-wrap">{u.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <time dateTime={u.createdAt}>{formatDateTime(u.createdAt, ctx.timezone)}</time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Your place">
            {mine?.status === "going" && <Badge>{past ? "You went" : "You're going"}</Badge>}
            {mine?.checkedIn && <Badge variant="secondary">Checked in</Badge>}
            {!past && !cancelled && (
              <RsvpControl
                eventId={event.id}
                status={mine?.status ?? null}
                full={full}
                open={open}
                waitlistPosition={detail.waitlistPosition}
              />
            )}
            {!cancelled &&
              (mine?.status === "going" || detail.canStaff) &&
              Math.abs(new Date(event.startsAt).getTime() - now) < 6 * 3_600_000 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/events/${event.id}/live`}>Live run: share location (opt-in)</Link>
                </Button>
              )}
            {active && paceGroups.length > 0 && !past && (
              <PaceGroupPicker eventId={event.id} groups={paceGroups} current={mine?.paceGroupId ?? null} />
            )}
            {detail.result && (
              <p className="text-sm">
                Your result:{" "}
                <span className="font-medium">
                  {detail.result.outcome === "finished"
                    ? `Finished${detail.result.finish_seconds ? ` in ${formatDuration(detail.result.finish_seconds)}` : ""}`
                    : detail.result.outcome === "dnf"
                      ? "Did not finish"
                      : "Did not start"}
                </span>
              </p>
            )}
          </section>
          {detail.team.length > 0 && (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="team">
              <h2 id="team" className="font-semibold text-brand-navy">
                Event team
              </h2>
              <ul className="space-y-1 text-sm">
                {detail.team.map((m, i) => (
                  <li key={`${m.display_name}-${i}`}>
                    {m.display_name} <span className="text-muted-foreground">· {TEAM_ROLE_LABEL[m.role]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Button asChild variant="link" className="px-0">
            <Link href="/events">All events</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
