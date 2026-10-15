import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressMeter } from "@/components/shared/progress-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDistance, formatDuration, formatLocalDate, WORKOUT_TYPE_LABEL } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BADGE_BY_CODE } from "@/features/gamification/logic/badges";
import { ActivityChart, ConsistencyChart, StreakChart } from "@/features/reports/components/report-charts";
import { loadReport } from "@/features/reports/queries";
import { ReportPeriod } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const PERIOD_LABEL = { week: "Week", month: "Month", year: "Year" } as const;

function rangeLabel(period: ReportPeriod, start: string, end: string) {
  if (period === "year") return start.slice(0, 4);
  if (period === "month") return formatLocalDate(start, { month: "long", year: "numeric" });
  return `${formatLocalDate(start, { day: "numeric", month: "short" })} – ${formatLocalDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Reports" description="Weekly, monthly and yearly summaries of your training." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="reports" />
      </>
    );

  const sp = await searchParams;
  const period = ReportPeriod.catch("week").parse(sp.period);
  const offset = Math.min(0, Math.max(-520, Number.parseInt(String(sp.offset ?? "0"), 10) || 0));
  const { report, plannedSource, badgesInPeriod } = await loadReport(ctx, period, offset);
  const link = (p: ReportPeriod, o: number) => `/reports?period=${p}&offset=${o}`;
  const bucketWord = period === "week" ? "day" : period === "month" ? "week" : "month";

  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Report period" className="inline-flex rounded-lg bg-muted p-1">
            {ReportPeriod.options.map((p) => (
              <Link
                key={p}
                href={link(p, 0)}
                aria-current={p === period ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground",
                  p === period && "bg-card text-brand-navy shadow-sm",
                )}
              >
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label={`Previous ${period}`}>
              <Link href={link(period, offset - 1)}>
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <span className="min-w-40 text-center text-sm font-medium text-brand-navy">
              {rangeLabel(period, report.range.start, report.range.end)}
            </span>
            {offset < 0 ? (
              <Button asChild variant="outline" size="icon" aria-label={`Next ${period}`}>
                <Link href={link(period, offset + 1)}>
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <span className="size-10" aria-hidden />
            )}
          </div>
        </div>

        {report.isEmpty ? (
          <EmptyState
            icon={ChartColumn}
            title="No workouts in this period"
            description="Completed workouts show up here with time, distance and consistency."
            action={
              <Button asChild>
                <Link href="/dashboard">Go to today</Link>
              </Button>
            }
          />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Workouts", String(report.workoutCount)],
                ["Active time", formatDuration(report.activeSeconds)],
                ["Running distance", formatDistance(report.runDistanceMeters)],
                ["Consistency", `${report.activeDays} active days (${report.consistency}%)`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border bg-card p-4">
                  <dt className="text-sm text-muted-foreground">{k}</dt>
                  <dd className="text-xl font-semibold text-brand-navy">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Active time</CardTitle>
                  <CardDescription>Minutes per {bucketWord}.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ActivityChart data={report.series} label={`Active minutes per ${bucketWord}`} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Consistency trend</CardTitle>
                  <CardDescription>Active days per {bucketWord} (10+ minutes counts).</CardDescription>
                </CardHeader>
                <CardContent>
                  <ConsistencyChart data={report.series} label={`Active days per ${bucketWord}`} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Habit streak</CardTitle>
                  <CardDescription>Longest in this period: {report.longestStreakInPeriod} days.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StreakChart data={report.streakSeries} label="Habit streak by day" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Planned vs completed</CardTitle>
                  <CardDescription>
                    {plannedSource === "schedule"
                      ? "Planned sessions from your schedule."
                      : plannedSource === "programme"
                        ? "Planned = your programmes' weekly session targets."
                        : "Enrol in a programme or plan your week to compare."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {report.planned.planned ? (
                    <ProgressMeter
                      label="Planned sessions completed"
                      value={Math.min(report.planned.completed, report.planned.planned)}
                      max={report.planned.planned}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {report.planned.completed} programme or planned sessions completed.
                    </p>
                  )}
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-brand-navy">Activity mix</h3>
                    <ul className="space-y-2 text-sm">
                      {report.byType.map((t) => (
                        <li key={t.type} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 text-brand-navy">{WORKOUT_TYPE_LABEL[t.type]}</span>
                          <span className="h-2 flex-1 rounded-full bg-muted">
                            <span
                              className="block h-2 rounded-full bg-brand-navy"
                              style={{
                                width: `${Math.round((t.minutes / Math.max(1, report.byType[0].minutes)) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
                            {t.count} · {t.minutes} min
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Goals and achievements</CardTitle>
            <CardDescription>Badges earned in this period.</CardDescription>
          </CardHeader>
          <CardContent>
            {badgesInPeriod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new badges in this period.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {badgesInPeriod.map((code) => (
                  <li key={code} className="rounded-full border px-3 py-1 text-sm font-medium text-brand-navy">
                    {BADGE_BY_CODE.get(code)?.title ?? code}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
