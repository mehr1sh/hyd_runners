import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { WorkoutGenerator } from "@/features/training/components/workout-generator";
import { predictionsFor, profileLevel } from "@/features/training/server/data";

export const metadata: Metadata = { title: "Workout generator" };

export default async function SessionsPage() {
  const ctx = await getRunnerContext();
  const [preds, level] = ctx
    ? await Promise.all([predictionsFor(ctx.supabase), profileLevel(ctx.supabase, ctx.user.id)])
    : [null, "returning" as const];
  return (
    <>
      <PageHeader
        title="Workout generator"
        description="Structured sessions with a warm-up, main set, recoveries and cool-down, sized to your level. Paces come from your own best efforts when you have them."
      />
      <div className="max-w-3xl">
        <WorkoutGenerator paces={preds?.paces ?? null} defaultLevel={level} />
      </div>
    </>
  );
}
