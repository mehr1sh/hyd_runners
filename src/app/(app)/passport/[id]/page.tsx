import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { publicEnv } from "@/lib/env";
import { deleteRace, toggleChecklist } from "@/features/passport/actions";
import { RaceDetailsForm, ResultForm } from "@/features/passport/components/forms";
import { CheckInQr } from "@/features/passport/components/qr";
import { bestResult, countdown, RACE_DISTANCE_LABEL, RESULT_SOURCE_LABEL } from "@/features/passport/logic";
import { raceHub } from "@/features/passport/queries";
import { predictionsFor } from "@/features/training/server/data";

export const metadata: Metadata = { title: "Race" };

const LEVEL = { new_to_running: "New", returning: "Returning", regular: "Regular" } as const;

export default async function RacePage({ params }: PageProps<"/passport/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="the Race Passport" />;
  const hub = await raceHub(ctx.supabase, id, ctx.user.id);
  if (!hub) notFound();
  const { entry, event, partners, raceDayActivities } = hub;
  const preds =
    entry.distance !== "other"
      ? (await predictionsFor(ctx.supabase)).predictions.find((p) => p.race === entry.distance)
      : undefined;
  const result = bestResult(event?.result ?? null, { seconds: entry.resultSeconds, source: entry.resultSource });
  const raceDay = entry.raceDate === ctx.today;
  const past = entry.raceDate < ctx.today;
  const site = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

  return (
    <>
      <PageHeader
        title={entry.name}
        description={`${entry.raceDate} · ${RACE_DISTANCE_LABEL[entry.distance]}${entry.city ? ` · ${entry.city}` : ""}`}
      />
      <p className="mb-4 text-sm">
        <Link href="/passport" className="underline underline-offset-4">
          Race Passport
        </Link>
      </p>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section
            aria-labelledby="day-h"
            className={`space-y-3 rounded-xl border p-4 ${raceDay ? "border-brand-red bg-brand-red-soft" : "bg-card"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="day-h" className="font-semibold text-brand-navy">
                {raceDay ? "Race day" : "Race-day details"}
              </h2>
              <Badge>{countdown(ctx.today, entry.raceDate)}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Bib</dt>
                <dd className="font-medium">{entry.bib ?? "Not added"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Wave</dt>
                <dd>{entry.wave ?? "—"}</dd>
              </div>
              {event && (
                <>
                  <div>
                    <dt className="text-muted-foreground">Start</dt>
                    <dd>{formatDateTime(event.startsAt, ctx.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Meeting point</dt>
                    <dd>{event.location?.name ?? "See the event page"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pace group</dt>
                    <dd>{event.rsvp?.paceGroup ?? "None chosen"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Check-in</dt>
                    <dd>{event.rsvp?.checkedInAt ? "Checked in" : event.rsvp ? "Not yet" : "No place booked"}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-muted-foreground">Emergency contact</dt>
                <dd>
                  {entry.emergencyName
                    ? `${entry.emergencyName}${entry.emergencyPhone ? `, ${entry.emergencyPhone}` : ""}`
                    : "Not added"}
                </dd>
              </div>
            </dl>
            {event && (
              <p className="flex flex-wrap gap-3 text-sm">
                <Link href={`/events/${event.id}`} className="underline underline-offset-4">
                  Event page and updates
                </Link>
                {event.routeId && (
                  <Link href={`/events/${event.id}#event-route`} className="underline underline-offset-4">
                    Route and elevation
                  </Link>
                )}
              </p>
            )}
            {event?.rsvp?.status === "going" && !past && (
              <CheckInQr
                url={`${site}/events/${event.id}/check-in?token=${event.rsvp.checkinToken}`}
                label={`Check-in code for ${entry.name}`}
              />
            )}
            {!event && (
              <p className="text-xs text-muted-foreground">
                This race isn&apos;t run on HYD Runners, so check-in, routes and organiser results come from the race
                itself.
              </p>
            )}
          </section>

          <section aria-labelledby="check-h" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="check-h" className="font-semibold text-brand-navy">
              Checklist
            </h2>
            <ul className="space-y-1 text-sm">
              {entry.checklist.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <form action={toggleChecklist} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={entry.id} />
                    <input type="hidden" name="item" value={i.id} />
                    <button type="submit" aria-pressed={i.done} className="flex items-center gap-2 text-left">
                      <span
                        aria-hidden
                        className={`inline-flex size-4 items-center justify-center rounded border ${i.done ? "bg-success text-white" : ""}`}
                      >
                        {i.done ? "✓" : ""}
                      </span>
                      <span className={i.done ? "text-muted-foreground line-through" : ""}>{i.label}</span>
                    </button>
                  </form>
                  <form action={toggleChecklist}>
                    <input type="hidden" name="id" value={entry.id} />
                    <input type="hidden" name="item" value={i.id} />
                    <input type="hidden" name="remove" value="1" />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${i.label}`}>
                      ×
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={toggleChecklist} className="flex gap-2">
              <input type="hidden" name="id" value={entry.id} />
              <Input name="add" placeholder="Add an item" aria-label="New checklist item" maxLength={120} />
              <Button type="submit" size="sm" variant="outline">
                Add
              </Button>
            </form>
          </section>

          <section aria-labelledby="result-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="result-h" className="font-semibold text-brand-navy">
              Result
            </h2>
            {result ? (
              <p className="text-lg font-semibold">
                {result.seconds
                  ? formatDuration(result.seconds)
                  : result.outcome === "dnf"
                    ? "Did not finish"
                    : "Recorded"}{" "}
                <Badge variant="outline">{RESULT_SOURCE_LABEL[result.source]}</Badge>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {past || raceDay ? "No result yet." : "Your result goes here after the race."}
              </p>
            )}
            {event?.result && (
              <p className="text-xs text-muted-foreground">
                The organiser&apos;s result is shown instead of one you enter.
              </p>
            )}
            {(past || raceDay) && (
              <ResultForm
                entryId={entry.id}
                reflection={entry.reflection}
                activities={raceDayActivities.map((a) => ({
                  id: a.id,
                  label: `${a.name ?? "Activity"} · ${(Number(a.distance_m) / 1000).toFixed(2)} km · ${formatDuration(a.elapsed_seconds)}`,
                }))}
              />
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section aria-labelledby="prep-h" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <h2 id="prep-h" className="font-semibold text-brand-navy">
              Preparation
            </h2>
            {entry.targetSeconds && <p>Target: {formatDuration(entry.targetSeconds)}</p>}
            {preds &&
              (preds.ok ? (
                <p>
                  Current estimate: {formatDuration(preds.seconds)} ({formatDuration(preds.low)}–
                  {formatDuration(preds.high)}), not a guarantee.
                </p>
              ) : (
                <p className="text-muted-foreground">No estimate: {preds.reason}</p>
              ))}
            <p className="flex flex-wrap gap-3">
              <Link href="/training" className="underline underline-offset-4">
                Training plan for this race
              </Link>
              <Link href="/training/pace" className="underline underline-offset-4">
                Pacing plan
              </Link>
            </p>
          </section>
          <section aria-labelledby="partners-h" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <h2 id="partners-h" className="font-semibold text-brand-navy">
              Race partners
            </h2>
            {!entry.findPartners ? (
              <p className="text-muted-foreground">
                Turn on &ldquo;Let other runners find me&rdquo; below to see runners in this race with a similar target.
              </p>
            ) : partners.length === 0 ? (
              <p className="text-muted-foreground">Nobody with a similar target has opted in yet.</p>
            ) : (
              <ul className="space-y-1" aria-label="Race partners">
                {partners.map((p) => (
                  <li key={p.user_id}>
                    <Link href={`/runners/${p.user_id}`} className="underline-offset-4 hover:underline">
                      {p.display_name}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {p.target_seconds ? `target ${formatDuration(p.target_seconds)}` : "no target"}
                      {p.fitness_level ? ` · ${LEVEL[p.fitness_level as keyof typeof LEVEL]}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {event && event.sponsors.length > 0 && (
            <section aria-labelledby="sp-h" className="space-y-1 rounded-xl border bg-card p-4 text-sm">
              <h2 id="sp-h" className="font-semibold text-brand-navy">
                Sponsors
              </h2>
              {event.sponsors.map((s) => (
                <p key={s.name}>
                  {s.url ? (
                    <a
                      href={s.url}
                      rel="noopener noreferrer sponsored"
                      target="_blank"
                      className="underline underline-offset-4"
                    >
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </p>
              ))}
            </section>
          )}
          <section aria-labelledby="details-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="details-h" className="font-semibold text-brand-navy">
              Registration and logistics
            </h2>
            <RaceDetailsForm entry={entry} />
            {entry.travelNotes && <p className="text-xs text-muted-foreground">Travel notes are private to you.</p>}
          </section>
          <form action={deleteRace}>
            <input type="hidden" name="id" value={entry.id} />
            <Button type="submit" variant="ghost" size="sm">
              Remove from passport
            </Button>
          </form>
        </aside>
      </div>
    </>
  );
}
