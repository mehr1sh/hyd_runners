import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { listLocations, listUpcomingEvents } from "@/features/community/queries";
import { MapExplorerClient } from "@/features/community/components/map-explorer-client";
import { listLocationUpdates } from "@/features/community/service";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { LocationKind } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Map" };

const KIND_LABEL: Record<string, string> = {
  park: "Parks",
  track: "Tracks",
  lake_loop: "Lake loops",
  gym: "Gyms",
  trail: "Trails",
  other: "Other",
};

/** Managers also receive scheduled notices; the map shows only published ones. */
function publishedOnly<T extends { publishAt: string }>(updates: T[]) {
  const now = Date.now();
  return updates.filter((update) => new Date(update.publishAt).getTime() <= now);
}

export default async function MapPage({ searchParams }: PageProps<"/map">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader title="Places to run" description="Public parks, tracks and lake loops, with upcoming group runs." />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the location map" />
      </>
    );

  const sp = await searchParams;
  const kind = LocationKind.safeParse(sp.kind);
  const selected = z.uuid().safeParse(sp.location);
  const [locations, events, updates] = await Promise.all([
    listLocations(),
    listUpcomingEvents(100),
    listLocationUpdates(ctx.supabase),
  ]);
  const notices = updates.ok ? publishedOnly(updates.data) : [];
  const counts = new Map<string, number>();
  for (const e of events) if (e.locationId) counts.set(e.locationId, (counts.get(e.locationId) ?? 0) + 1);
  const all = locations.map((l) => ({ ...l, upcomingEvents: counts.get(l.id) ?? 0 }));
  const shown = kind.success ? all.filter((l) => l.kind === kind.data) : all;
  const kinds = [...new Set(all.map((l) => l.kind))];
  const href = (k: string | null, loc?: string) => {
    const q = new URLSearchParams();
    if (k) q.set("kind", k);
    if (loc) q.set("location", loc);
    const s = q.toString();
    return s ? `/map?${s}` : "/map";
  };

  return (
    <>
      {header}
      <div className="space-y-4">
        <nav aria-label="Filter places" className="flex flex-wrap gap-2">
          {[null, ...kinds].map((k) => {
            const active = (k ?? null) === (kind.success ? kind.data : null);
            return (
              <Link
                key={k ?? "all"}
                href={href(k)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  active
                    ? "border-brand-navy bg-brand-navy-soft font-medium text-brand-navy"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {k ? KIND_LABEL[k] : "All places"}
              </Link>
            );
          })}
        </nav>

        <MapExplorerClient locations={shown} selectedId={selected.success ? selected.data : null} />
        <p className="text-xs text-muted-foreground">
          Only public meeting places are shown. We never show where individual runners live or train. Red pins have
          upcoming events.
        </p>

        <section aria-labelledby="list-heading">
          <h2 id="list-heading" className="sr-only">
            List of places
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {shown.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">No places in this category yet.</li>
            )}
            {shown.map((l) => (
              <li key={l.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-brand-navy">{l.name}</p>
                    <p className="text-muted-foreground">
                      {KIND_LABEL[l.kind]}
                      {l.address && ` · ${l.address}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!l.verified && <Badge variant="outline">Unverified sample</Badge>}
                    <Link
                      href={href(kind.success ? kind.data : null, l.id)}
                      className="text-brand-red-strong underline-offset-4 hover:underline"
                    >
                      Show on map
                    </Link>
                    {l.upcomingEvents > 0 && (
                      <Link
                        href={`/events?location=${l.id}`}
                        className="text-brand-red-strong underline-offset-4 hover:underline"
                      >
                        {l.upcomingEvents} event{l.upcomingEvents === 1 ? "" : "s"}
                      </Link>
                    )}
                  </div>
                </div>
                {notices
                  .filter((update) => update.locationId === l.id)
                  .map((update) => (
                    <p key={update.id} className="rounded-lg bg-brand-navy-soft px-3 py-2">
                      <span className="font-medium text-brand-navy">{update.title}. </span>
                      {update.body}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
