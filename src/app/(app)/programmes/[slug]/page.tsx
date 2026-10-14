import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Flag } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressMeter } from "@/components/shared/progress-meter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatLocalDate } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { enrollAction, leaveProgrammeAction, startWorkoutAction } from "@/features/workouts/actions";
import { ActionButton } from "@/features/workouts/components/action-form";
import { SessionBlocks } from "@/features/workouts/components/session-blocks";
import { restDays } from "@/features/workouts/logic/programme-progress";
import { getProgrammeDetail } from "@/features/workouts/programme-queries";

export const metadata: Metadata = { title: "Programme" };

const DAY = ["", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

export default async function ProgrammePage({ params }: PageProps<"/programmes/[slug]">) {
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Programme" />
        <RunnerPreviewNotice feature="training programmes" />
      </>
    );
  const { slug } = await params;
  const detail = await getProgrammeDetail(ctx, slug);
  if (!detail) notFound();
  const { programme, enrollment, sessions, progress } = detail;
  const status = enrollment?.status ?? null;
  const open = status === "active";
  const weeks = [...new Set(sessions.map((s) => s.week))];

  return (
    <>
      <PageHeader title={programme.title} description={programme.summary} />
      <div className="space-y-8">
        <section aria-label="Your progress" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          {!enrollment || status === "withdrawn" || status === "completed" ? (
            <div className="space-y-3">
              {status === "completed" && (
                <p className="font-medium text-success">You have completed this programme. You can start it again.</p>
              )}
              <p className="text-sm text-muted-foreground">
                {programme.durationWeeks} weeks · {programme.sessionsPerWeek} sessions a week.{" "}
                {programme.enrolment === "coach_approval"
                  ? "This is a coach-led programme: you request a place and a coach confirms it. Enrolment is free during the pilot; paid places may come later."
                  : "Free to join. Rest days are built in between sessions."}
              </p>
              <ActionButton
                action={enrollAction}
                fields={{ programmeId: programme.id, slug: programme.slug }}
                label={programme.enrolment === "coach_approval" ? "Request a place" : "Start this programme"}
              />
            </div>
          ) : status === "requested" ? (
            <Alert>
              <AlertDescription>
                Your request has been sent. A coach will confirm your place; sessions unlock once you are approved.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {progress && <ProgressMeter label="Sessions completed" value={progress.completed} max={progress.total} />}
              {status === "paused" && (
                <form action={leaveProgrammeAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="enrollmentId" value={enrollment.id} />
                  <input type="hidden" name="status" value="active" />
                  <span className="text-sm text-muted-foreground">Paused. Your progress is saved.</span>
                  <Button type="submit">Resume</Button>
                </form>
              )}
              {open && progress?.next && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Up next: <span className="font-medium text-brand-navy">{progress.next.title}</span>
                    {progress.restRecommended && progress.nextRecommendedDate && (
                      <> — rest first, recommended from {formatLocalDate(progress.nextRecommendedDate)}.</>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action={startWorkoutAction}
                      fields={{ kind: "programme", enrollmentId: enrollment.id, sessionId: progress.next.id }}
                      label="Start session"
                      variant={progress.restRecommended ? "outline" : "default"}
                    />
                    <Button asChild variant="ghost">
                      <Link href={`/workouts/new?enrollment=${enrollment.id}&session=${progress.next.id}`}>
                        I already did it
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
              {open && (
                <form action={leaveProgrammeAction}>
                  <input type="hidden" name="enrollmentId" value={enrollment.id} />
                  <input type="hidden" name="status" value="paused" />
                  <Button type="submit" variant="ghost" size="sm">
                    Pause programme
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="plan-heading" className="space-y-3">
          <h2 id="plan-heading" className="text-lg font-semibold text-brand-navy">
            Week by week
          </h2>
          <div className="space-y-2">
            {weeks.map((week) => {
              const list = sessions.filter((s) => s.week === week);
              const weekDone = progress?.weeksCompleted.includes(week);
              const current = progress?.currentWeek === week && !progress.finished;
              return (
                <details key={week} open={current} className="group rounded-xl border bg-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span className="font-medium text-brand-navy">Week {week}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {weekDone && (
                        <Badge variant="secondary">
                          <Check aria-hidden /> Done
                        </Badge>
                      )}
                      {current && <Badge>Current</Badge>}
                      {list.length} sessions
                    </span>
                  </summary>
                  <div className="space-y-4 border-t px-4 py-4">
                    <p className="text-xs text-muted-foreground">
                      Rest days:{" "}
                      {restDays(list.map((s) => s.day))
                        .map((d) => DAY[d])
                        .join(", ")}
                    </p>
                    {list.map((s) => {
                      const done = progress?.doneSessionIds.has(s.id);
                      return (
                        <article key={s.id} className="space-y-2">
                          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-brand-navy">
                            {done ? <Check className="size-4 text-success" aria-label="Completed" /> : null}
                            {DAY[s.day]} · {s.title}
                            <span className="font-normal text-muted-foreground">~{s.estimatedMinutes} min</span>
                            {s.isMilestone && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-red-strong">
                                <Flag className="size-3" aria-hidden /> Milestone
                              </span>
                            )}
                          </h3>
                          {s.instructions && <p className="text-sm text-muted-foreground">{s.instructions}</p>}
                          <SessionBlocks blocks={s.blocks} />
                        </article>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            General fitness guidance, not medical advice. Stop and rest if you feel pain, dizziness or chest discomfort.
          </p>
        </section>
      </div>
    </>
  );
}
