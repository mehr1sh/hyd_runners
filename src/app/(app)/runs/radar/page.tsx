import type { Metadata } from "next";
import Link from "next/link";
import { CalendarSearch } from "lucide-react";
import { LocationMap } from "@/components/map/location-map";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { radarRuns } from "@/features/live/queries";

export const metadata: Metadata = { title: "Run Radar" };

export default async function RadarPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Run Radar"
      description="Group runs across Hyderabad in the next two weeks: where they meet, when they start, pace groups and open spots. Runners' own locations are never shown."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="Run Radar" />
      </>
    );
  const runs = await radarRuns(ctx.supabase);
  return (
    <>
      {header}
      {runs.length === 0 ? (
        <EmptyState
          icon={CalendarSearch}
          title="No group runs in the next two weeks"
          description="Check back soon, or start one with your club."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <LocationMap
            label="Map of upcoming group runs"
            points={runs.map((r) => ({
              id: r.id,
              name: r.title,
              latitude: r.lat,
              longitude: r.lon,
              note: `${formatDateTime(r.startsAt, ctx.timezone)} · ${r.locationName}`,
            }))}
          />
          <ul className="space-y-2" aria-label="Upcoming group runs">
            {runs.map((r) => {
              const spots = r.capacity === null ? null : Math.max(0, r.capacity - r.going);
              return (
                <li key={r.id} className="space-y-1 rounded-xl border bg-card p-3 text-sm">
                  <Link href={`/events/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-muted-foreground">
                    {formatDateTime(r.startsAt, ctx.timezone)} · {r.locationName}
                  </p>
                  <p>
                    {spots === null
                      ? `${r.going} going, no limit`
                      : spots === 0
                        ? "Full (waiting list)"
                        : `${spots} of ${r.capacity} spots open`}
                  </p>
                  {r.paceGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.paceGroups.map((g) => (
                        <Badge key={g} variant="outline">
                          {g}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
