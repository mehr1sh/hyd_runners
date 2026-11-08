import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { myMemberships } from "@/features/clubs/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { paceRangeLabel } from "@/features/events/logic";
import { SeriesControls } from "@/features/group-runs/components/series-forms";
import { formatLocalTime, weekdayName } from "@/features/group-runs/logic";
import { getSeries } from "@/features/group-runs/queries";

export const metadata: Metadata = { title: "Group run" };

export default async function SeriesPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Group run" />
        <RunnerPreviewNotice feature="group runs" />
      </>
    );
  const page = await getSeries(ctx.supabase, id);
  if (!page) notFound();
  const { series } = page;
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const membership = series.clubId
    ? (await myMemberships(ctx.supabase, ctx.user.id, [series.clubId])).get(series.clubId)
    : null;
  const canManage = isManager || (membership?.status === "active" && membership.role === "admin");

  return (
    <>
      <PageHeader
        title={series.title}
        description={`Every ${weekdayName(series.weekday)} at ${formatLocalTime(series.startTime)}, ${series.durationMinutes} minutes`}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="About this run">
            <div className="flex flex-wrap gap-2">
              {series.beginnerFriendly && <Badge>Beginner friendly</Badge>}
              {series.noDrop && <Badge variant="outline">No-drop</Badge>}
              {!series.active && <Badge variant="outline">Paused</Badge>}
              {page.club && (
                <Badge variant="secondary">
                  <Link href={`/clubs/${page.club.slug}`}>{page.club.name}</Link>
                </Badge>
              )}
            </div>
            {page.location && (
              <p className="text-sm">
                Where:{" "}
                <Link href={`/map?location=${page.location.id}`} className="underline underline-offset-4">
                  {page.location.name}
                </Link>
                {series.meetingPoint ? ` · ${series.meetingPoint}` : ""}
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">How we regroup:</span> {series.regroupPolicy}
            </p>
            {series.description && <p className="text-sm whitespace-pre-wrap">{series.description}</p>}
          </section>
          <section className="space-y-2" aria-labelledby="pace">
            <h2 id="pace" className="font-semibold text-brand-navy">
              Pace groups
            </h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              {series.paceGroups.map((g) => (
                <li key={g.label} className="rounded-full border px-3 py-1">
                  {g.label}{" "}
                  <span className="text-muted-foreground">
                    ({paceRangeLabel(g.min_pace_seconds, g.max_pace_seconds, g.run_walk)})
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Not sure of your pace? Pick the slower group; you can move up any week.
            </p>
          </section>
          <section className="space-y-2" aria-labelledby="upcoming">
            <h2 id="upcoming" className="font-semibold text-brand-navy">
              Coming up
            </h2>
            {page.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs scheduled yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Upcoming runs">
                {page.upcoming.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 p-3">
                    <Link href={`/events/${e.id}`} className="underline underline-offset-4">
                      {formatDateTime(e.startsAt, ctx.timezone)}
                    </Link>
                    <span className="text-muted-foreground">RSVP and pick a pace group</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          {canManage && <SeriesControls seriesId={series.id} active={series.active} />}
          <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="history">
            <h2 id="history" className="font-semibold text-brand-navy">
              Recent turnout
            </h2>
            {page.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No past runs yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {page.history.map((h) => (
                  <li key={h.eventId}>
                    {formatDateTime(h.startsAt, ctx.timezone)} · {h.checkedIn} checked in of {h.going} going
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Link href="/runs" className="text-sm underline underline-offset-4">
            All group runs
          </Link>
        </aside>
      </div>
    </>
  );
}
