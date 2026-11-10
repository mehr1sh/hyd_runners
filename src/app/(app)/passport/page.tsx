import type { Metadata } from "next";
import Link from "next/link";
import { Medal } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { localDate } from "@/features/gamification/logic/time";
import { AddRaceForm } from "@/features/passport/components/forms";
import { bestResult, countdown, RACE_DISTANCE_LABEL, RESULT_SOURCE_LABEL } from "@/features/passport/logic";
import { myRaces } from "@/features/passport/queries";

export const metadata: Metadata = { title: "Race Passport" };

export default async function PassportPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Race Passport"
      description="Every race in one place: preparation, race-day details, results and history, with each result's source."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the Race Passport" />
      </>
    );
  const { entries, upcomingEvents, verified } = await myRaces(ctx.supabase, ctx.user.id);
  const upcoming = entries
    .filter((e) => e.raceDate >= ctx.today && !["completed", "dnf", "dns", "cancelled"].includes(e.status))
    .reverse();
  const history = entries.filter((e) => !upcoming.includes(e));
  const linkedEvents = new Set(entries.map((e) => e.eventId));
  const unlinkedResults = [...verified.entries()].filter(([id]) => !linkedEvents.has(id));
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="up-h" className="space-y-2">
            <h2 id="up-h" className="font-semibold text-brand-navy">
              Coming up
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={Medal}
                title="No races planned"
                description="Add a race you're registered for or thinking about."
              />
            ) : (
              <ul className="space-y-2" aria-label="Upcoming races">
                {upcoming.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4"
                  >
                    <span>
                      <Link href={`/passport/${e.id}`} className="font-semibold underline-offset-4 hover:underline">
                        {e.name}
                      </Link>
                      <span className="block text-sm text-muted-foreground">
                        {e.raceDate} · {RACE_DISTANCE_LABEL[e.distance]}
                        {e.targetSeconds ? ` · target ${formatDuration(e.targetSeconds)}` : ""}
                      </span>
                    </span>
                    <Badge>{countdown(ctx.today, e.raceDate)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="hist-h" className="space-y-2">
            <h2 id="hist-h" className="font-semibold text-brand-navy">
              Race history
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Race history">
              {history.map((e) => {
                const v = e.eventId ? verified.get(e.eventId) : undefined;
                const r = bestResult(v ? { finishSeconds: v.finishSeconds, outcome: v.outcome } : null, {
                  seconds: e.resultSeconds,
                  source: e.resultSource,
                });
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      <Link href={`/passport/${e.id}`} className="font-medium underline-offset-4 hover:underline">
                        {e.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {e.raceDate} · {RACE_DISTANCE_LABEL[e.distance]}
                      </span>
                    </span>
                    <span className="text-right">
                      {r?.seconds
                        ? formatDuration(r.seconds)
                        : e.status === "dnf"
                          ? "Did not finish"
                          : e.status === "dns"
                            ? "Did not start"
                            : "No result"}
                      {r && (
                        <span className="block text-xs text-muted-foreground">{RESULT_SOURCE_LABEL[r.source]}</span>
                      )}
                    </span>
                  </li>
                );
              })}
              {unlinkedResults.map(([id, v]) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <Link href={`/events/${id}`} className="font-medium underline-offset-4 hover:underline">
                      {v.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">{localDate(v.startsAt, ctx.timezone)}</span>
                  </span>
                  <span className="text-right">
                    {v.outcome === "finished"
                      ? v.finishSeconds
                        ? formatDuration(v.finishSeconds)
                        : "Finished"
                      : v.outcome === "dnf"
                        ? "Did not finish"
                        : "Did not start"}
                    <span className="block text-xs text-muted-foreground">
                      {RESULT_SOURCE_LABEL.organizer_verified}
                    </span>
                  </span>
                </li>
              ))}
              {history.length + unlinkedResults.length === 0 && (
                <li className="p-3 text-muted-foreground">No past races yet.</li>
              )}
            </ul>
          </section>
        </div>
        <aside className="space-y-4">
          {upcomingEvents.length > 0 && (
            <section aria-labelledby="from-h" className="space-y-3 rounded-xl border bg-card p-4">
              <h2 id="from-h" className="font-semibold text-brand-navy">
                From your HYD Runners events
              </h2>
              {upcomingEvents.slice(0, 3).map((ev) => (
                <AddRaceForm
                  key={ev.id}
                  event={{ id: ev.id, title: ev.title, date: localDate(ev.starts_at, ctx.timezone) }}
                />
              ))}
            </section>
          )}
          <section aria-labelledby="add-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="add-h" className="font-semibold text-brand-navy">
              Add a race
            </h2>
            <AddRaceForm />
          </section>
        </aside>
      </div>
    </>
  );
}
