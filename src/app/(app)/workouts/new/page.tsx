import type { Metadata } from "next";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { ManualWorkoutForm } from "@/features/workouts/components/manual-workout-form";
import { listLocationOptions } from "@/features/workouts/queries";
import type { WorkoutType } from "@/lib/contracts";

export const metadata: Metadata = { title: "Log a workout" };

export default async function NewWorkoutPage({ searchParams }: PageProps<"/workouts/new">) {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Log a workout" description="Record a workout you have already finished." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="workout logging" />
      </>
    );

  const sp = await searchParams;
  const enrollmentId = z.uuid().safeParse(sp.enrollment);
  const sessionId = z.uuid().safeParse(sp.session);
  let link: Parameters<typeof ManualWorkoutForm>[0]["link"];
  let defaults: { title: string; workoutType: WorkoutType; minutes: number } | undefined;

  if (enrollmentId.success && sessionId.success) {
    const { data: session } = await ctx.supabase
      .from("programme_sessions")
      .select("title, workout_type, estimated_minutes")
      .eq("id", sessionId.data)
      .maybeSingle();
    if (session) {
      link = { linkKind: "programme", enrollmentId: enrollmentId.data, sessionId: sessionId.data };
      defaults = { title: session.title, workoutType: session.workout_type, minutes: session.estimated_minutes };
    }
  }

  return (
    <>
      {header}
      <div className="max-w-xl rounded-xl border bg-card p-4 sm:p-6">
        <ManualWorkoutForm link={link} defaults={defaults} locations={await listLocationOptions(ctx)} />
      </div>
    </>
  );
}
