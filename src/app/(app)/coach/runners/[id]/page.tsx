import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { km, pace, duration } from "@/features/activities/logic/format";
import { CoachNoteForm, CoachProposalForm, ReplyForm } from "@/features/coach-platform/components/forms";
import { coachProposalsFor, coachRunnerOverview, notesFor, sharedRecoveryFor } from "@/features/coach-platform/queries";
import { formatDuration } from "@/features/events/logic";
import { localDate } from "@/features/gamification/logic/time";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Runner" };

const NOTE_LABEL = {
  workout_feedback: "Workout feedback",
  progress_note: "Progress note",
  recommendation: "Recommendation",
} as const;
const BEST_LABEL: Record<string, string> = {
  "1k": "1 km",
  "1mi": "1 mile",
  "5k": "5 km",
  "10k": "10 km",
  half: "Half",
  marathon: "Marathon",
};

export default async function CoachRunnerPage({ params }: PageProps<"/coach/runners/[id]">) {
  const access = await requireRole(["coach", "mentor", "programme_manager", "admin"]);
  if (!access.allowed) return <AccessDenied area="The coach area" />;
  if (!access.user) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const overview = await coachRunnerOverview(supabase, id);
  if (!overview) return <AccessDenied area="This runner" />;
  const [notes, recovery, proposals] = await Promise.all([
    notesFor(supabase, id),
    sharedRecoveryFor(supabase, id),
    coachProposalsFor(supabase, id),
  ]);
  const tz = overview.timezone ?? "Asia/Kolkata";
  const { past, upcoming } = splitSessions(overview.sessions ?? []);
  const maxWeek = Math.max(1, ...(overview.weeks ?? []).map((w) => w.distanceM));

  return (
    <>
      <PageHeader
        title={overview.displayName}
        description="Training your runner shares with you. GPS tracks and private journal entries are never shown."
      />
      <p className="mb-4 text-sm">
        <Link href="/coach" className="underline underline-offset-4">
          All runners
        </Link>
      </p>
      {!overview.sharesTraining ? (
        <p className="rounded-xl border bg-card p-4 text-sm">
          {overview.displayName} has turned off training sharing. You can still send notes and see their replies.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="weekly-h" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="weekly-h" className="font-semibold text-brand-navy">
              Weekly distance (12 weeks)
            </h2>
            {(overview.weeks ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities in the last 12 weeks.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {overview.weeks!.map((w) => (
                  <li key={w.weekStart} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-muted-foreground">{w.weekStart}</span>
                    <span
                      className="h-3 rounded bg-brand-navy"
                      style={{ width: `${(w.distanceM / maxWeek) * 60}%` }}
                      aria-hidden
                    />
                    <span>
                      {km(w.distanceM)} · {w.runs} {w.runs === 1 ? "activity" : "activities"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {overview.bestEfforts && Object.keys(overview.bestEfforts).length > 0 && (
              <p className="text-sm">
                <span className="font-medium">GPS best efforts: </span>
                {Object.entries(overview.bestEfforts)
                  .map(([k, s]) => `${BEST_LABEL[k] ?? k} ${formatDuration(s)}`)
                  .join(" · ")}
              </p>
            )}
            {overview.raceGoal && (
              <p className="text-sm">
                <span className="font-medium">Race goal: </span>
                {overview.raceGoal.name ?? overview.raceGoal.distance} on {overview.raceGoal.raceDate}
                {overview.raceGoal.targetSeconds ? `, target ${formatDuration(overview.raceGoal.targetSeconds)}` : ""}
              </p>
            )}
          </section>

          <section aria-labelledby="plan-h" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="plan-h" className="font-semibold text-brand-navy">
              Planned and completed
            </h2>
            <p className="text-sm">
              Last 14 days: {past.filter((s) => s.status === "completed").length} of{" "}
              {past.filter((s) => s.status !== "skipped").length} planned sessions completed,{" "}
              {past.filter((s) => s.status === "missed").length} missed.
            </p>
            <ul className="space-y-1 text-sm">
              {upcoming.slice(0, 10).map((s) => (
                <li key={s.id}>
                  {localDate(s.startsAt, tz)} · {s.title} · {s.minutes} min
                  {s.plannedBy === "coach" && (
                    <Badge variant="outline" className="ml-1">
                      From you
                    </Badge>
                  )}
                </li>
              ))}
              {upcoming.length === 0 && (
                <li className="text-muted-foreground">Nothing planned in the next three weeks.</li>
              )}
            </ul>
            {(overview.strength ?? []).length > 0 && (
              <p className="text-sm text-muted-foreground">
                Strength: {overview.strength!.map((s) => `${s.date} ${s.title.replace("Strength: ", "")}`).join(" · ")}
              </p>
            )}
          </section>

          <section aria-labelledby="acts-h" className="space-y-2 rounded-xl border bg-card p-4 lg:col-span-2">
            <h2 id="acts-h" className="font-semibold text-brand-navy">
              Recent activities
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Date</th>
                    <th>Distance</th>
                    <th>Time</th>
                    <th>Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview.activities ?? []).map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-1">{localDate(a.startedAt, tz)}</td>
                      <td>{km(a.distanceM)}</td>
                      <td>{duration(a.movingS)}</td>
                      <td>{a.type === "run" || a.type === "walk_run" ? pace(a.paceS) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="notes-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="notes-h" className="font-semibold text-brand-navy">
            Feedback and notes
          </h2>
          <CoachNoteForm
            runnerId={id}
            activities={(overview.activities ?? [])
              .slice(0, 10)
              .map((a) => ({ id: a.id, label: `${localDate(a.startedAt, tz)} · ${km(a.distanceM)}` }))}
          />
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="space-y-1 border-t pt-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {NOTE_LABEL[n.kind]} · {n.coachName ?? "Coach"} · {n.createdAt.slice(0, 10)}
                </p>
                <p className="whitespace-pre-line">{n.body}</p>
                {n.replies.map((r) => (
                  <p key={r.id} className="ml-4 border-l-2 pl-2">
                    <span className="font-medium">{r.authorId === id ? overview.displayName : "Coach"}: </span>
                    {r.body}
                  </p>
                ))}
                <ReplyForm noteId={n.id} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="propose-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="propose-h" className="font-semibold text-brand-navy">
            Propose plan changes
          </h2>
          <CoachProposalForm
            runnerId={id}
            sessions={upcoming
              .slice(0, 10)
              .map((s) => ({ id: s.id, label: `${localDate(s.startsAt, tz)} · ${s.title}`, minutes: s.minutes }))}
          />
          <h3 className="pt-2 text-sm font-semibold">Proposals</h3>
          <ul className="space-y-1 text-sm">
            {proposals.map((p) => (
              <li key={p.id}>
                {p.title} · {p.kind === "return_to_run" ? "return to running" : "yours"} ·{" "}
                <span className="font-medium">{p.status}</span>
                {p.applied_changes ? ` (${p.applied_changes.length} of ${p.changes.length} applied)` : ""}
              </li>
            ))}
            {proposals.length === 0 && <li className="text-muted-foreground">None yet.</li>}
          </ul>
        </section>

        <section aria-labelledby="rec-h" className="space-y-2 rounded-xl border bg-card p-4 lg:col-span-2">
          <h2 id="rec-h" className="font-semibold text-brand-navy">
            Recovery entries shared with you
          </h2>
          {recovery.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your runner hasn&apos;t shared any journal entries. Sharing is their choice, entry by entry.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {recovery.map((e) => (
                <li key={e.entry_date}>
                  {e.entry_date}
                  {e.fatigue !== null && ` · fatigue ${e.fatigue}/5`}
                  {e.soreness !== null && ` · soreness ${e.soreness}/5`}
                  {e.sleep_quality !== null && ` · sleep ${e.sleep_quality}/5`}
                  {e.notes && <span className="block text-muted-foreground">{e.notes}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Self-reported by your runner. Not medical information; refer pain or symptoms to a professional.
          </p>
        </section>
      </div>
    </>
  );
}

/** Sessions before now, and planned sessions from now on. */
function splitSessions<T extends { startsAt: string; status: string }>(sessions: T[]) {
  const now = Date.now();
  return {
    past: sessions.filter((s) => Date.parse(s.startsAt) < now),
    upcoming: sessions.filter((s) => Date.parse(s.startsAt) >= now && s.status === "planned"),
  };
}
