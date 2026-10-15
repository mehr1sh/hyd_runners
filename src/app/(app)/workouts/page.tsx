import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime, formatDistance, formatDuration, WORKOUT_TYPE_LABEL } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { localDate, weekStart } from "@/features/gamification/logic/time";
import { getInProgressWorkout, listCompletedWorkouts } from "@/features/workouts/queries";

export const metadata: Metadata = { title: "Workouts" };

export default async function WorkoutsPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Workout history"
      description="Every session you complete, with time, distance and how it felt."
      actions={
        <Button asChild>
          <Link href="/workouts/new">
            <Plus aria-hidden /> Log a workout
          </Link>
        </Button>
      }
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="workout tracking" />
      </>
    );

  const [workouts, inProgress] = await Promise.all([listCompletedWorkouts(ctx, 200), getInProgressWorkout(ctx)]);
  const thisWeek = weekStart(ctx.today);
  const week = workouts.filter((w) => weekStart(localDate(w.startedAt, ctx.timezone)) === thisWeek);
  const totals = [
    { label: "This week", value: `${week.length} workout${week.length === 1 ? "" : "s"}` },
    { label: "Active time this week", value: formatDuration(week.reduce((s, w) => s + (w.durationSeconds ?? 0), 0)) },
    { label: "All-time workouts", value: String(workouts.length) },
  ];

  return (
    <>
      {header}
      <div className="space-y-6">
        {inProgress && (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-brand-red bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-red-strong">In progress</p>
              <p className="font-medium text-brand-navy">{inProgress.title}</p>
            </div>
            <Button asChild>
              <Link href={`/workouts/${inProgress.id}`}>Continue</Link>
            </Button>
          </div>
        )}

        <dl className="grid gap-3 sm:grid-cols-3">
          {totals.map((t) => (
            <div key={t.label} className="rounded-xl border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{t.label}</dt>
              <dd className="text-xl font-semibold text-brand-navy">{t.value}</dd>
            </div>
          ))}
        </dl>

        {workouts.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No workouts yet"
            description="Start a programme session or log something you have already done."
            action={
              <Button asChild>
                <Link href="/programmes">Browse programmes</Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableCaption className="sr-only">Completed workouts, newest first</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Workout</TableHead>
                  <TableHead className="hidden sm:table-cell">When</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workouts.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="max-w-56 whitespace-normal">
                      <Link
                        href={`/workouts/${w.id}`}
                        className="font-medium text-brand-navy underline-offset-4 hover:underline"
                      >
                        {w.title}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {WORKOUT_TYPE_LABEL[w.workoutType]}
                        <span className="sm:hidden">· {formatDateTime(w.startedAt, ctx.timezone)}</span>
                        {w.source === "simulated" && <Badge variant="outline">Simulated</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDateTime(w.startedAt, ctx.timezone)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(w.durationSeconds)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {formatDistance(w.distanceMeters)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
