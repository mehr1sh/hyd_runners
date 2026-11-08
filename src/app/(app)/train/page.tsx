import type { Metadata } from "next";
import { Activity, CalendarDays, ChartColumn, Dumbbell } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { addDays, localMidnightUtc, weekStart } from "@/features/gamification/logic/time";
import { HubCard } from "@/features/shared/hub-card";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export const metadata: Metadata = { title: "Train" };

export default async function TrainPage() {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Train" description="Your plan, programmes, workouts and progress in one place." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="training" />
      </>
    );
  const start = weekStart(ctx.today);
  const from = localMidnightUtc(start, ctx.timezone).toISOString();
  const to = localMidnightUtc(addDays(start, 7), ctx.timezone).toISOString();
  const [planned, done, enrolled] = await Promise.all([
    ctx.supabase
      .from("scheduled_workouts")
      .select("id", { count: "exact", head: true })
      .gte("starts_at", from)
      .lt("starts_at", to),
    ctx.supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("started_at", from)
      .lt("started_at", to),
    ctx.supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id)
      .eq("status", "active"),
  ]);
  for (const [name, r] of [
    ["scheduled_workouts", planned],
    ["workout_logs", done],
    ["enrollments", enrolled],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }
  const n = (c: number | null) => c ?? 0;
  return (
    <>
      {header}
      <ul className="grid gap-3 sm:grid-cols-2">
        <HubCard
          href="/schedule"
          icon={CalendarDays}
          title="Schedule"
          description="Plan your week around your timetable."
          figure={`${n(planned.count)} workout${n(planned.count) === 1 ? "" : "s"} planned this week`}
        />
        <HubCard
          href="/programmes"
          icon={Dumbbell}
          title="Programmes"
          description="Couch to 5K, running plans, strength and mobility."
          figure={
            n(enrolled.count)
              ? `${n(enrolled.count)} active programme${n(enrolled.count) === 1 ? "" : "s"}`
              : "Not in a programme yet"
          }
        />
        <HubCard
          href="/workouts"
          icon={Activity}
          title="Workouts"
          description="Log a run or walk, or look back at past sessions."
          figure={`${n(done.count)} completed this week`}
        />
        <HubCard
          href="/reports"
          icon={ChartColumn}
          title="Reports"
          description="Minutes, distance and consistency by week, month and year."
          figure="See your progress"
        />
      </ul>
    </>
  );
}
