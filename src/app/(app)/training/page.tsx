import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { addDays, daysBetween } from "@/features/gamification/logic/time";
import { ProposalReview, RaceGoalForm, SimpleAction } from "@/features/training/components/forms";
import { setCoachSharing } from "@/features/coach-platform/actions";
import { ReplyForm } from "@/features/coach-platform/components/forms";
import { notesFor } from "@/features/coach-platform/queries";
import { WorkoutSteps } from "@/features/training/components/workout-steps";
import { heatAdvice, HEAT_LABEL } from "@/features/training/logic/heat";
import { RACE_DISTANCES } from "@/features/training/logic/predict";
import type { WorkoutDetails } from "@/features/training/logic/workouts";
import {
  activeGoal,
  forecastHours,
  overdueSessions,
  predictionsFor,
  profileLevel,
  proposals,
  sessionsBetween,
} from "@/features/training/server/data";

export const metadata: Metadata = { title: "Race preparation" };

const KIND_LABEL = {
  race_plan: "Race plan",
  missed_session: "Missed session",
  adaptive: "Adaptive adjustment",
  coach: "From your coach",
  return_to_run: "Return to running",
} as const;
const STATUS_LABEL = {
  proposed: "Waiting for you",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Replaced",
} as const;

export default async function TrainingPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Race preparation"
      description="Set a race goal, get a structured plan built from your running, and approve every change before it reaches your schedule."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="race preparation" />
      </>
    );
  const { supabase, user, timezone, today } = ctx;
  const [goal, preds, props, overdue, upcoming, level, forecast, notes, sharing] = await Promise.all([
    activeGoal(supabase, user.id),
    predictionsFor(supabase),
    proposals(supabase, user.id),
    overdueSessions(supabase, user.id, timezone, today),
    sessionsBetween(supabase, user.id, timezone, today, 7),
    profileLevel(supabase, user.id),
    forecastHours(),
    notesFor(supabase, user.id),
    supabase.from("profiles").select("coach_sees_training").eq("id", user.id).maybeSingle(),
  ]);
  const sharesTraining = (sharing.data?.coach_sees_training as boolean | undefined) ?? true;
  const open = props.filter((p) => p.status === "proposed");
  const decided = props.filter((p) => p.status !== "proposed").slice(0, 5);
  const proposedFor = new Set(
    props
      .filter((p) => p.kind === "missed_session")
      .flatMap((p) =>
        p.changes.filter((c) => c.op === "mark_missed").map((c) => ("workout_id" in c ? c.workout_id : "")),
      ),
  );
  const race = goal ? RACE_DISTANCES.find((r) => r.key === goal.distance)! : null;
  const goalPred = goal ? preds.predictions.find((p) => p.race === goal.distance) : null;

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="goal-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="goal-h" className="font-semibold text-brand-navy">
              Race goal
            </h2>
            {goal && race ? (
              <>
                <p className="text-lg font-semibold">
                  {goal.name ?? race.label} · {goal.raceDate}
                </p>
                <p className="text-sm text-muted-foreground">
                  {race.label} in {daysBetween(today, goal.raceDate)} days
                  {goal.targetSeconds ? ` · target ${formatDuration(goal.targetSeconds)}` : " · no target time"} ·{" "}
                  {goal.daysPerWeek} days a week
                </p>
                {goalPred &&
                  (goalPred.ok ? (
                    <p className="text-sm">
                      Current estimate: <strong>{formatDuration(goalPred.seconds)}</strong> (range{" "}
                      {formatDuration(goalPred.low)}–{formatDuration(goalPred.high)})
                      {goal.targetSeconds &&
                        (goalPred.seconds <= goal.targetSeconds
                          ? ". Your estimate is at or ahead of your target."
                          : `. About ${formatDuration(goalPred.seconds - goal.targetSeconds)} slower than your target.`)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No estimate yet: {goalPred.reason}</p>
                  ))}
                <div className="flex flex-wrap gap-2">
                  <SimpleAction kind="plan" label="Generate a plan" />
                  <SimpleAction kind="complete" label="Mark race done" variant="outline" />
                  <SimpleAction kind="abandon" label="Drop this goal" variant="ghost" />
                </div>
              </>
            ) : (
              <RaceGoalForm defaultLevel={level} minDate={addDays(today, 1)} maxDate={addDays(today, 365)} />
            )}
          </section>

          <section aria-labelledby="proposals-h" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="proposals-h" className="font-semibold text-brand-navy">
                Proposed changes
              </h2>
              <SimpleAction kind="adaptive" label="Check this week" variant="outline" />
            </div>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing waiting. Proposals appear here and change your schedule only when you accept them.
              </p>
            ) : (
              open.map((p) => (
                <article key={p.id} className="space-y-2 rounded-xl border bg-card p-4" aria-label={p.title}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{KIND_LABEL[p.kind]}</Badge>
                    <h3 className="font-semibold">{p.title}</h3>
                  </div>
                  <p className="text-sm">{p.summary}</p>
                  {p.reasons.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {p.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <ProposalReview
                    id={p.id}
                    changes={p.changes.map((c, i) => ({
                      index: i + 1,
                      label: c.label,
                      group:
                        p.kind === "race_plan" || p.kind === "return_to_run"
                          ? (c.label.split(",")[0] ?? "Sessions")
                          : "Changes",
                    }))}
                  />
                  {(p.kind === "race_plan" || p.kind === "return_to_run") && (
                    <p className="text-xs text-muted-foreground">
                      A generated recommendation, not a prescription. Untick any session you don&apos;t want; you can
                      move sessions later in your schedule.
                    </p>
                  )}
                </article>
              ))
            )}
            {decided.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer">Recent decisions</summary>
                <ul className="mt-2 space-y-1">
                  {decided.map((p) => (
                    <li key={p.id}>
                      {p.title}: {STATUS_LABEL[p.status]}
                      {p.appliedChanges ? ` (${p.appliedChanges.length} of ${p.changes.length} changes)` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section aria-labelledby="missed-h" className="space-y-3">
            <h2 id="missed-h" className="font-semibold text-brand-navy">
              Sessions that didn&apos;t happen
            </h2>
            {overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No planned sessions from the last two weeks are left open.
              </p>
            ) : (
              <ul className="space-y-2">
                {overdue.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm"
                  >
                    <span>
                      {s.date} · {s.title} · {s.minutes} min
                    </span>
                    {proposedFor.has(s.id) ? (
                      <span className="text-muted-foreground">Proposal made</span>
                    ) : (
                      <SimpleAction
                        kind="missed"
                        label="Plan around it"
                        fields={{ workoutId: s.id }}
                        variant="outline"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Missed training is never made up by adding extra load. Easy sessions are let go; key sessions move only
              when a safe nearby day exists.
            </p>
          </section>

          <section aria-labelledby="week-h" className="space-y-3">
            <h2 id="week-h" className="font-semibold text-brand-navy">
              Next 7 days
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={Flag}
                title="Nothing planned this week"
                description="Accept a race plan, or plan your week on the schedule."
              />
            ) : (
              <ul className="space-y-3">
                {upcoming.map((s) => {
                  const hour = forecast?.hours.find(
                    (h) => Math.abs(new Date(h.time).getTime() - new Date(s.startsAt).getTime()) < 1_800_000,
                  );
                  const heat = hour
                    ? heatAdvice(
                        hour.apparentC ?? hour.tempC,
                        hour.humidityPct,
                        s.minutes,
                        s.kind === "long"
                          ? "long"
                          : ["tempo", "intervals", "hills", "progression"].includes(s.kind)
                            ? "quality"
                            : "easy",
                      )
                    : null;
                  const d = s.details as (WorkoutDetails & { kind: string }) | null;
                  return (
                    <li key={s.id} className="space-y-2 rounded-xl border bg-card p-4">
                      <p className="font-medium">
                        {s.date} {s.startTime} · {s.title} · {s.minutes} min
                      </p>
                      {d && "warmup" in d && <WorkoutSteps workout={d} />}
                      {heat && heat.band !== "none" && (
                        <div className="rounded-md bg-muted/50 p-2 text-sm">
                          <p className="font-medium">
                            {HEAT_LABEL[heat.band]} forecast · {heat.basis}
                            {forecast && !forecast.live ? " (sample data, not live weather)" : ""}
                          </p>
                          <ul className="list-disc pl-5">
                            {heat.advice.map((a) => (
                              <li key={a}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {forecast?.live && (
              <p className="text-xs text-muted-foreground">
                Heat guidance: {forecast.attribution}, city centre forecast.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section aria-labelledby="pred-h" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="pred-h" className="font-semibold text-brand-navy">
              Race estimates
            </h2>
            <ul className="space-y-2 text-sm">
              {preds.predictions.map((p) => (
                <li key={p.race}>
                  <span className="font-medium">{p.label}: </span>
                  {p.ok ? (
                    <>
                      {formatDuration(p.seconds)}{" "}
                      <span className="text-muted-foreground">
                        ({formatDuration(p.low)}–{formatDuration(p.high)})
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{p.reason}</span>
                  )}
                </li>
              ))}
            </ul>
            {preds.predictions.find((p) => p.ok) && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">How these are calculated</summary>
                <ul className="mt-1 list-disc pl-4">
                  {[...new Set(preds.predictions.flatMap((p) => (p.ok ? p.limitations : [])))].map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                  <li>Riegel&apos;s formula from your closest recent effort of 5 km or longer.</li>
                </ul>
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Estimates, not guaranteed finish times. Calculated {preds.calculatedAt.slice(0, 10)}.
            </p>
          </section>
          <section aria-labelledby="coach-h" id="coach" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="coach-h" className="font-semibold text-brand-navy">
              Your coach
            </h2>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Feedback from an assigned coach appears here.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {notes.slice(0, 5).map((n) => (
                  <li key={n.id} className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {n.coachName ?? "Your coach"} · {n.createdAt.slice(0, 10)}
                    </p>
                    <p className="whitespace-pre-line">{n.body}</p>
                    {n.replies.map((r) => (
                      <p key={r.id} className="ml-3 border-l-2 pl-2 text-muted-foreground">
                        {r.authorId === user.id ? "You" : "Coach"}: {r.body}
                      </p>
                    ))}
                    <ReplyForm noteId={n.id} />
                  </li>
                ))}
              </ul>
            )}
            <form action={setCoachSharing} className="space-y-1 border-t pt-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="share" defaultChecked={sharesTraining} className="mt-1" />
                <span>
                  Let my assigned coach see my training summaries (never GPS tracks or unshared journal entries)
                </span>
              </label>
              <button type="submit" className="text-sm underline underline-offset-4">
                Save sharing choice
              </button>
            </form>
          </section>
          <nav aria-label="Training tools" className="space-y-1 rounded-xl border bg-card p-4 text-sm">
            <Link href="/training/pace" className="block underline underline-offset-4">
              Pace calculator
            </Link>
            <Link href="/training/sessions" className="block underline underline-offset-4">
              Workout generator
            </Link>
            <Link href="/schedule" className="block underline underline-offset-4">
              Your schedule
            </Link>
          </nav>
        </aside>
      </div>
    </>
  );
}
