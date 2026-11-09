import type { Metadata } from "next";
import Link from "next/link";
import { Upload, Activity as ActivityIcon } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { RoutePreview } from "@/components/shared/route-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACTIVITY_TYPE_LABEL, duration, km, pace, VISIBILITY_LABEL } from "@/features/activities/logic/format";
import { listMyActivities } from "@/features/activities/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { localMidnightUtc, addDays } from "@/features/gamification/logic/time";

export const metadata: Metadata = { title: "Activities" };

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export default async function ActivitiesPage({ searchParams }: PageProps<"/activities">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Activities"
      description="Runs and walks imported from GPX or FIT files."
      actions={
        <Button asChild>
          <Link href="/activities/import">
            <Upload className="size-4" aria-hidden /> Import
          </Link>
        </Button>
      }
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="activities" />
      </>
    );
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const type = z.enum(["run", "walk_run", "walk", "hike"]).safeParse(one("type"));
  const from = dateParam.safeParse(one("from"));
  const to = dateParam.safeParse(one("to"));
  const before = z.iso.datetime({ offset: true }).safeParse(one("before"));
  const filters = {
    type: type.success ? type.data : null,
    from: from.success ? localMidnightUtc(from.data, ctx.timezone).toISOString() : null,
    to: to.success ? localMidnightUtc(addDays(to.data, 1), ctx.timezone).toISOString() : null,
    before: before.success ? before.data : null,
  };
  const { activities, nextBefore } = await listMyActivities(ctx.supabase, ctx.user.id, filters);
  const params = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (filters.type) p.set("type", filters.type);
    if (from.success) p.set("from", from.data);
    if (to.success) p.set("to", to.data);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/activities?${p}`;
  };

  return (
    <>
      {header}
      <div className="space-y-6">
        <form
          method="get"
          action="/activities"
          className="flex flex-wrap items-end gap-2"
          aria-label="Filter activities"
        >
          <div className="grid gap-1 text-xs">
            <label htmlFor="f-type">Type</label>
            <select
              id="f-type"
              name="type"
              defaultValue={filters.type ?? ""}
              className="h-9 rounded-lg border px-2 text-sm"
            >
              <option value="">All</option>
              {Object.entries(ACTIVITY_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1 text-xs">
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              type="date"
              name="from"
              defaultValue={from.success ? from.data : ""}
              className="h-9 rounded-lg border px-2 text-sm"
            />
          </div>
          <div className="grid gap-1 text-xs">
            <label htmlFor="f-to">To</label>
            <input
              id="f-to"
              type="date"
              name="to"
              defaultValue={to.success ? to.data : ""}
              className="h-9 rounded-lg border px-2 text-sm"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
        {activities.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title={filters.type || filters.from || filters.to ? "No activities match" : "No imported activities yet"}
            description="Export a GPX or FIT file from your watch or phone app and import it here to see splits, pace and records."
            action={
              <Button asChild>
                <Link href="/activities/import">Import an activity</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3" aria-label="Activities">
            {activities.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/activities/${a.id}`}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 hover:border-brand-navy focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <RoutePreview coordinates={a.publicPath} className="h-14 w-14 shrink-0 text-brand-red" label="" />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-semibold text-brand-navy">{a.name ?? ACTIVITY_TYPE_LABEL[a.type]}</span>
                    <span className="block text-sm text-muted-foreground">
                      {a.startedAt ? formatDateTime(a.startedAt, ctx.timezone) : "Not processed yet"}
                    </span>
                    {a.status === "ready" ? (
                      <span className="block text-sm">
                        {km(a.distanceM)} · {duration(a.movingSeconds)} · {pace(a.avgPace)}
                        {a.elevationGain !== null ? ` · ↑${Math.round(a.elevationGain)} m` : ""}
                      </span>
                    ) : (
                      <Badge variant="outline">{a.status === "failed" ? "Import failed" : "Processing"}</Badge>
                    )}
                  </span>
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {VISIBILITY_LABEL[a.visibility]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {nextBefore && (
          <Button asChild variant="outline">
            <Link href={params({ before: nextBefore })}>Older activities</Link>
          </Button>
        )}
      </div>
    </>
  );
}
