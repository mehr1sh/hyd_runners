import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { TrendCharts } from "@/features/activities/components/trend-charts";
import { duration, km, pace } from "@/features/activities/logic/format";
import { PR_DISTANCES } from "@/features/activities/logic/normalize";
import { runningDna } from "@/features/activities/logic/performance";
import { loadPerformance, loadYear, resolveRange } from "@/features/activities/performance-queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance Lab" };

const MIX_LABEL: Record<string, string> = {
  easy: "Easy runs",
  long: "Long runs",
  hard: "Hard sessions",
  recovery: "Recovery runs",
  walk_or_hike: "Walks and hikes",
  strength: "Strength",
  mobility: "Mobility",
  conditioning: "Conditioning",
  cross_training: "Cross-training",
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Performance Lab"
      description="What your imported activities say about your running. Every number comes from your own data."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the Performance Lab" />
      </>
    );
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const rangeKind = one("range") ?? "month";
  const range = resolveRange(rangeKind, ctx.today, one("from"), one("to"));
  const thisYear = Number(ctx.today.slice(0, 4));
  const yearParam = Number(one("year"));
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= thisYear ? yearParam : thisYear;
  const [perf, yearly] = await Promise.all([
    loadPerformance(ctx.supabase, ctx.user.id, range, ctx.timezone, ctx.today),
    loadYear(ctx.supabase, year, ctx.timezone),
  ]);
  const dna = runningDna(perf.dna);
  const s = perf.summary;
  const hasAny = perf.dna.length > 0 || perf.efforts.length > 0 || yearly.activities > 0 || s.activities > 0;

  if (!hasAny) {
    return (
      <>
        {header}
        <EmptyState
          icon={Gauge}
          title="Import an activity to start"
          description="The Performance Lab needs GPS activities with timestamps. Import a GPX or FIT file from your watch or phone."
          action={
            <Button asChild>
              <Link href="/activities/import">Import an activity</Link>
            </Button>
          }
        />
      </>
    );
  }

  const ranges = [
    ["week", "This week"],
    ["month", "This month"],
    ["12w", "12 weeks"],
    ["year", "This year"],
  ] as const;
  const mixTotal = perf.mix.reduce((t, m) => t + m.sessions, 0);

  return (
    <>
      {header}
      <div className="space-y-8">
        <section aria-labelledby="overview" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="overview" className="font-semibold text-brand-navy">
              {range.label}
            </h2>
            <nav aria-label="Period" className="flex flex-wrap gap-2">
              {ranges.map(([k, l]) => (
                <Link
                  key={k}
                  href={`/performance?range=${k}`}
                  aria-current={rangeKind === k ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm",
                    rangeKind === k ? "border-brand-navy bg-brand-navy text-white" : "",
                  )}
                >
                  {l}
                </Link>
              ))}
              <form method="get" action="/performance" className="flex flex-wrap items-end gap-1">
                <input type="hidden" name="range" value="custom" />
                <label className="sr-only" htmlFor="p-from">
                  From
                </label>
                <input
                  id="p-from"
                  type="date"
                  name="from"
                  required
                  defaultValue={rangeKind === "custom" ? range.from : ""}
                  className="h-8 rounded-md border px-2 text-sm"
                />
                <label className="sr-only" htmlFor="p-to">
                  To
                </label>
                <input
                  id="p-to"
                  type="date"
                  name="to"
                  required
                  defaultValue={rangeKind === "custom" ? range.to : ""}
                  className="h-8 rounded-md border px-2 text-sm"
                />
                <Button type="submit" size="sm" variant="outline">
                  Custom
                </Button>
              </form>
            </nav>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Distance", km(s.distanceM)],
                ["Moving time", duration(s.movingSeconds)],
                ["Average pace", pace(s.avgPace)],
                ["Activities", `${s.activities} (${s.runs} runs, ${s.walks + s.hikes} walks/hikes)`],
                ["Active days", String(s.activeDays)],
                ["Elevation gain", `${Math.round(s.elevationGainM)} m`],
                ["Longest", km(s.longestM)],
                [
                  "Planned workouts done",
                  perf.planned.planned ? `${perf.planned.completed} of ${perf.planned.planned}` : "Nothing planned",
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-card p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-lg font-semibold text-brand-navy">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="trends" className="space-y-3">
          <h2 id="trends" className="font-semibold text-brand-navy">
            Last 26 weeks of running
          </h2>
          {perf.weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs in the last 26 weeks.</p>
          ) : (
            <TrendCharts data={perf.weekly} />
          )}
          <p className="text-xs text-muted-foreground">
            Pace trends mix easy runs and hard sessions. Compare like with like using pace by distance below or the
            same-route comparison on an activity.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="records" className="space-y-2">
            <h2 id="records" className="font-semibold text-brand-navy">
              Personal bests
            </h2>
            <p className="text-xs text-muted-foreground">
              Fastest times measured from your GPS tracks. Not official race results.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {PR_DISTANCES.map((d) => {
                  const e = perf.efforts.find((x) => x.key === d.key);
                  return (
                    <tr key={d.key} className="border-t">
                      <th scope="row" className="py-1.5 text-left font-normal">
                        {d.label}
                      </th>
                      <td className="text-right font-semibold text-brand-navy">
                        {e ? (
                          <Link href={`/activities/${e.activityId}`} className="underline-offset-4 hover:underline">
                            {formatDuration(e.seconds)}
                          </Link>
                        ) : (
                          <span className="font-normal text-muted-foreground">No run that long yet</span>
                        )}
                      </td>
                      <td className="pl-3 text-right text-xs text-muted-foreground">
                        {e ? formatDateTime(e.startedAt, ctx.timezone).split(",")[0] : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {perf.races.length > 0 && (
              <>
                <h3 className="pt-2 text-sm font-semibold text-brand-navy">Official event results</h3>
                <ul className="space-y-1 text-sm">
                  {perf.races.map((r) => (
                    <li key={r.eventId}>
                      <Link href={`/events/${r.eventId}`} className="underline-offset-4 hover:underline">
                        {r.title}
                      </Link>
                      {r.finishSeconds ? ` · ${formatDuration(r.finishSeconds)}` : " · finished"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="dna" className="space-y-2">
            <h2 id="dna" className="font-semibold text-brand-navy">
              Your running DNA right now
            </h2>
            {!dna.enoughData ? (
              <p className="text-sm text-muted-foreground">
                Import at least four activities from the last eight weeks to see patterns.
              </p>
            ) : (
              <>
                {dna.traits.length === 0 && <p className="text-sm">No strong pattern stands out yet. Keep going.</p>}
                <ul className="space-y-2">
                  {dna.traits.map((t) => (
                    <li key={t.key} className="rounded-xl border bg-card p-3 text-sm">
                      <p className="font-semibold text-brand-navy">{t.title}</p>
                      <p className="text-muted-foreground">{t.evidence}</p>
                    </li>
                  ))}
                </ul>
                {dna.trend && <p className="text-sm">{dna.trend}</p>}
                <p className="text-xs text-muted-foreground">Based on the last 16 weeks. It changes as you do.</p>
              </>
            )}
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="bands" className="space-y-2">
            <h2 id="bands" className="font-semibold text-brand-navy">
              Pace by distance ({range.label.toLowerCase()})
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {perf.bands.map((b) => (
                  <tr key={b.band} className="border-t">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {b.band}
                    </th>
                    <td className="text-right">{b.activities ? pace(b.avgPace) : "—"}</td>
                    <td className="pl-3 text-right text-xs text-muted-foreground">
                      {b.activities} run{b.activities === 1 ? "" : "s"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-labelledby="mix" className="space-y-2">
            <h2 id="mix" className="font-semibold text-brand-navy">
              Training mix ({range.label.toLowerCase()})
            </h2>
            {mixTotal === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions in this period.</p>
            ) : (
              <ul className="space-y-1.5 text-sm" aria-label="Training mix">
                {perf.mix.map((m) => (
                  <li key={m.category} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2">
                    <span>{MIX_LABEL[m.category] ?? m.category}</span>
                    <span className="h-2 rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-brand-navy"
                        style={{ width: `${(m.sessions / mixTotal) * 100}%` }}
                      />
                    </span>
                    <span className="text-right">{m.sessions}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Inferred from pace and distance compared with your own typical run, not from heart rate. Strength and
              mobility come from your logged workouts.
            </p>
          </section>
        </div>

        <section aria-labelledby="year" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="year" className="font-semibold text-brand-navy">
              {year} in running
            </h2>
            <nav aria-label="Year" className="flex gap-2 text-sm">
              {[thisYear - 1, thisYear].map((y) => (
                <Link
                  key={y}
                  href={`/performance?range=${rangeKind}&year=${y}`}
                  aria-current={y === year ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1",
                    y === year ? "border-brand-navy bg-brand-navy text-white" : "",
                  )}
                >
                  {y}
                </Link>
              ))}
            </nav>
          </div>
          {yearly.activities === 0 ? (
            <p className="text-sm text-muted-foreground">No imported activities in {year}.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Distance", km(yearly.distanceM)],
                  ["Time moving", duration(yearly.movingSeconds)],
                  ["Activities", String(yearly.activities)],
                  ["Elevation gain", `${Math.round(yearly.elevationGainM)} m`],
                  ["Longest", yearly.longest ? km(yearly.longest.distanceM) : null],
                  ["Fastest 5 km", yearly.fastest5k ? formatDuration(yearly.fastest5k.seconds) : null],
                  [
                    "Most active month",
                    yearly.mostActiveMonth
                      ? `${MONTHS[yearly.mostActiveMonth.month - 1]} (${km(yearly.mostActiveMonth.distanceM)})`
                      : null,
                  ],
                  ["Most repeated route", yearly.mostRepeatedRoute ? `${yearly.mostRepeatedRoute.times} times` : null],
                  ["Group runs", yearly.groupRunsAttended ? String(yearly.groupRunsAttended) : null],
                  ["Events checked in", yearly.eventsAttended ? String(yearly.eventsAttended) : null],
                  ["Clubs", yearly.clubs ? String(yearly.clubs) : null],
                ] as const
              )
                .filter(([, v]) => v !== null)
                .map(([k, v]) => (
                  <div key={k} className="rounded-xl border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="font-semibold text-brand-navy">{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </section>
      </div>
    </>
  );
}
