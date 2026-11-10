import type { Metadata } from "next";
import Link from "next/link";
import { Repeat, Sprout } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { listLocations } from "@/features/community/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { SeriesForm } from "@/features/group-runs/components/series-forms";
import { formatLocalTime, weekdayName } from "@/features/group-runs/logic";
import { listSeries, myRunHistory } from "@/features/group-runs/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Group runs" };

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Group runs"
      description="Weekly runs with pace groups, captains and a no-drop promise. Just turn up."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="group runs" />
      </>
    );
  const sp = await searchParams;
  const beginner = sp.level === "beginner";
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const [series, history, locations] = await Promise.all([
    listSeries(ctx.supabase, { beginner }),
    myRunHistory(ctx.supabase, ctx.user.id),
    listLocations(),
  ]);
  const placeName = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <>
      {header}
      <div className="space-y-6">
        <nav className="flex gap-2" aria-label="Level">
          {[
            { href: "/runs", label: "All runs", on: !beginner },
            { href: "/runs?level=beginner", label: "Beginner friendly", on: beginner },
          ].map((f) => (
            <Link
              key={f.href}
              href={f.href}
              aria-current={f.on ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                f.on ? "border-brand-navy bg-brand-navy text-white" : "",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {series.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={beginner ? "No beginner runs yet" : "No group runs yet"}
            description="Weekly runs organised by clubs and the programme team will appear here."
            action={
              <Button asChild variant="outline">
                <Link href="/events">See community events</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {series.map((s) => (
              <li key={s.id} className="space-y-2 rounded-xl border bg-card p-4">
                <h2 className="font-semibold text-brand-navy">
                  <Link href={`/runs/${s.id}`} className="underline-offset-4 hover:underline">
                    {s.title}
                  </Link>
                </h2>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    Every {weekdayName(s.weekday)}, {formatLocalTime(s.startTime)}
                  </Badge>
                  {s.beginnerFriendly && (
                    <Badge>
                      <Sprout className="size-3" aria-hidden /> Beginner friendly
                    </Badge>
                  )}
                  {s.noDrop && <Badge variant="outline">No-drop</Badge>}
                </div>
                {s.locationId && placeName.get(s.locationId) && (
                  <p className="text-sm text-muted-foreground">{placeName.get(s.locationId)}</p>
                )}
                <p className="text-sm">
                  {s.next ? (
                    <Link href={`/events/${s.next.id}`} className="underline underline-offset-4">
                      Next: {formatDateTime(s.next.startsAt, ctx.timezone)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No run scheduled yet.</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <section className="space-y-2" aria-labelledby="my-runs">
          <h2 id="my-runs" className="font-semibold text-brand-navy">
            Runs you&apos;ve been to
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Once a captain checks you in at a run, it shows up here.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {history.map((h) => (
                <li key={h.eventId} className="flex flex-wrap justify-between gap-2 p-3">
                  <Link href={`/events/${h.eventId}`} className="underline-offset-4 hover:underline">
                    {h.title}
                  </Link>
                  <span className="text-muted-foreground">{formatDateTime(h.startsAt, ctx.timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {isManager && (
          <section className="space-y-2" aria-labelledby="new-series">
            <h2 id="new-series" className="font-semibold text-brand-navy">
              Start a city-wide group run
            </h2>
            <p className="text-sm text-muted-foreground">
              Club admins start club runs from their club&apos;s management page.
            </p>
            <SeriesForm clubId={null} locations={locations} />
          </section>
        )}
      </div>
    </>
  );
}
