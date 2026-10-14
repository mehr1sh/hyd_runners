import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Coins, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime, formatDistance, formatDuration, WORKOUT_TYPE_LABEL } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { BADGE_BY_CODE } from "@/features/gamification/logic/badges";
import { ShareButtons } from "@/features/gamification/components/share-buttons";
import { abandonWorkoutAction } from "@/features/workouts/actions";
import { CompleteWorkoutForm } from "@/features/workouts/components/complete-workout-form";
import { SessionBlocks } from "@/features/workouts/components/session-blocks";
import { getWorkout, listLocationOptions } from "@/features/workouts/queries";
import { WorkoutBlock } from "@/lib/contracts";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Workout" };

const RULE_LABEL = (key: string) => {
  if (key.startsWith("workout:day:")) return "Workout completed";
  if (key.startsWith("plan:")) return "Followed your plan";
  if (key.startsWith("streak:daily:")) return `${key.split(":")[2]}-day habit streak`;
  if (key.startsWith("streak:weekly:")) return `${key.split(":")[2]} weeks meeting your goal`;
  if (key.startsWith("badge:")) return `Badge: ${BADGE_BY_CODE.get(key.slice(6))?.title ?? key.slice(6)}`;
  return key;
};

export default async function WorkoutPage({ params, searchParams }: PageProps<"/workouts/[id]">) {
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Workout" />
        <RunnerPreviewNotice feature="workout tracking" />
      </>
    );
  const { id } = await params;
  const { completed } = await searchParams;
  const detail = await getWorkout(ctx, id);
  if (!detail) notFound();
  const { workout, session, rewards } = detail;
  const blocks = WorkoutBlock.array()
    .catch([])
    .parse(session?.blocks ?? []);
  const xp = rewards.reduce((s, r) => s + r.delta_xp, 0);
  const coins = rewards.reduce((s, r) => s + r.delta_coins, 0);
  const badges = rewards.filter((r) => r.award_key.startsWith("badge:"));

  if (workout.status === "in_progress") {
    return (
      <>
        <PageHeader
          title={workout.title}
          description={
            session ? `${session.programmes.title} · week ${session.week}` : WORKOUT_TYPE_LABEL[workout.workoutType]
          }
        />
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section aria-labelledby="plan-heading" className="space-y-3">
            <h2 id="plan-heading" className="font-semibold text-brand-navy">
              Session plan
            </h2>
            {session?.instructions && <p className="text-sm text-muted-foreground">{session.instructions}</p>}
            {blocks.length ? (
              <SessionBlocks blocks={blocks} />
            ) : (
              <p className="text-sm text-muted-foreground">Go at your own pace.</p>
            )}
          </section>
          <section aria-labelledby="finish-heading" className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
            <h2 id="finish-heading" className="font-semibold text-brand-navy">
              Finish and save
            </h2>
            <CompleteWorkoutForm
              workoutId={workout.id}
              startedAt={workout.startedAt}
              suggestedMinutes={session?.estimated_minutes ?? null}
              showDistance={["run", "walk_run", "walk", "cross_training"].includes(workout.workoutType)}
              locations={await listLocationOptions(ctx)}
            />
            <form action={abandonWorkoutAction}>
              <input type="hidden" name="workoutId" value={workout.id} />
              <Button type="submit" variant="ghost" size="sm">
                Discard this workout
              </Button>
            </form>
          </section>
        </div>
      </>
    );
  }

  if (workout.status === "abandoned") notFound();

  const shareText = badges.length
    ? `I just earned “${RULE_LABEL(badges[0].award_key).replace("Badge: ", "")}” with HYD Runners!`
    : `I just completed “${workout.title}” (${formatDuration(workout.durationSeconds)}) with HYD Runners.`;

  return (
    <>
      <PageHeader title={workout.title} description={formatDateTime(workout.startedAt, ctx.timezone)} />
      <div className="space-y-6">
        {completed && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-success/40 bg-card p-4">
            <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
            <p className="font-medium text-brand-navy">
              Workout saved.{" "}
              {xp > 0
                ? `You earned ${xp} XP and ${coins} coins.`
                : "No new XP this time — rewards are limited to one workout per day."}
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription className="flex flex-wrap gap-2">
                {WORKOUT_TYPE_LABEL[workout.workoutType]}
                {workout.source === "simulated" && <Badge variant="outline">Simulated demo data</Badge>}
                {workout.source === "manual" && <Badge variant="outline">Logged manually</Badge>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Active time</dt>
                  <dd className="text-lg font-semibold text-brand-navy">{formatDuration(workout.durationSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Distance</dt>
                  <dd className="text-lg font-semibold text-brand-navy">{formatDistance(workout.distanceMeters)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Effort</dt>
                  <dd className="text-lg font-semibold text-brand-navy">
                    {workout.perceivedEffort ? `${workout.perceivedEffort}/10` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Place</dt>
                  <dd className="font-medium text-brand-navy">{detail.locationName ?? "—"}</dd>
                </div>
              </dl>
              {workout.notes && <p className="mt-4 text-sm text-muted-foreground">“{workout.notes}”</p>}
              {session && (
                <p className="mt-4 text-sm">
                  Part of{" "}
                  <Link
                    className="font-medium text-brand-red-strong underline-offset-4 hover:underline"
                    href={`/programmes/${session.programmes.slug}`}
                  >
                    {session.programmes.title}
                  </Link>{" "}
                  · week {session.week}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand-red" aria-hidden /> Rewards from this workout
              </CardTitle>
              <CardDescription>Calculated on the server from your workout history.</CardDescription>
            </CardHeader>
            <CardContent>
              {rewards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No XP for this one. Only your first workout each day earns XP, short sessions under 10 minutes do not
                  count, and after 6 active days in a week we encourage a rest day.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {rewards.map((r) => (
                    <li key={r.award_key} className="flex justify-between gap-3 py-2">
                      <span className="text-brand-navy">{RULE_LABEL(r.award_key)}</span>
                      <span className="flex shrink-0 gap-3 text-muted-foreground tabular-nums">
                        <span>+{r.delta_xp} XP</span>
                        <span className="inline-flex items-center gap-1">
                          <Coins className="size-3.5" aria-hidden />+{r.delta_coins}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <section aria-labelledby="share-heading" className="space-y-3">
          <h2 id="share-heading" className="font-semibold text-brand-navy">
            Share it
          </h2>
          <p className="text-sm text-muted-foreground">
            Shares a short message and a link to HYD Runners. Your location and profile stay private.
          </p>
          <ShareButtons text={shareText} url={publicEnv.NEXT_PUBLIC_SITE_URL} />
        </section>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/dashboard">Back to today</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/workouts">All workouts</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
