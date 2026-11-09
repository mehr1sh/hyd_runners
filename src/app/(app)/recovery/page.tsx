import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { addDays } from "@/features/gamification/logic/time";
import { deleteEntry } from "@/features/recovery/actions";
import { EntryForm } from "@/features/recovery/components/forms";
import { readiness, sourceLabel } from "@/features/recovery/logic/readiness";
import { dailyLoads, journal } from "@/features/recovery/server/queries";

export const metadata: Metadata = { title: "Recovery" };

const TREND_KEYS = [
  { key: "sleepQuality", label: "Sleep" },
  { key: "fatigue", label: "Fatigue" },
  { key: "soreness", label: "Soreness" },
  { key: "energy", label: "Energy" },
] as const;

export default async function RecoveryPage({ searchParams }: PageProps<"/recovery">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Recovery"
      description="A private journal of how you feel, and a readiness overview built from it and your training. Training guidance, not a medical assessment."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the recovery journal" />
      </>
    );
  const { supabase, user, timezone, today } = ctx;
  const sp = await searchParams;
  const minDate = addDays(today, -60);
  const date =
    typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today && sp.date >= minDate
      ? sp.date
      : today;
  const [entries, loads] = await Promise.all([
    journal(supabase, user.id, today),
    dailyLoads(supabase, user.id, timezone, today),
  ]);
  const r = readiness(loads, entries, today);
  const current = entries.find((e) => e.date === date) ?? null;
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="entry-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="entry-h" className="font-semibold text-brand-navy">
              {current ? `Your entry for ${date}` : `How are you on ${date}?`}
            </h2>
            <EntryForm date={date} maxDate={today} minDate={minDate} entry={current} />
          </section>

          <section aria-labelledby="trend-h" className="space-y-2">
            <h2 id="trend-h" className="font-semibold text-brand-navy">
              Last 14 days
            </h2>
            {entries.filter((e) => e.date >= last14[0]).length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet. Trends appear once you log a few days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-center text-xs">
                  <caption className="sr-only">Self-reported scores (1–5) by day</caption>
                  <thead>
                    <tr>
                      <th className="text-left font-medium">Day</th>
                      {last14.map((d) => (
                        <th key={d} scope="col" className="px-1 font-normal text-muted-foreground">
                          {d.slice(8)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TREND_KEYS.map((t) => (
                      <tr key={t.key}>
                        <th scope="row" className="py-1 text-left font-medium">
                          {t.label}
                        </th>
                        {last14.map((d) => {
                          const v = entries.find((e) => e.date === d)?.[t.key] ?? null;
                          return (
                            <td key={d} className="px-1">
                              {v === null ? (
                                <span className="text-muted-foreground">·</span>
                              ) : (
                                <span
                                  className="inline-block w-5 rounded-sm bg-brand-navy text-white"
                                  style={{ opacity: 0.25 + v * 0.15 }}
                                >
                                  {v}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="history-h" className="space-y-2">
            <h2 id="history-h" className="font-semibold text-brand-navy">
              Entries
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {entries.slice(0, 30).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-medium">{e.date}</span>
                    {e.fatigue !== null && ` · fatigue ${e.fatigue}`}
                    {e.soreness !== null && ` · soreness ${e.soreness}`}
                    {e.sleepQuality !== null && ` · sleep ${e.sleepQuality}`}
                    {e.shareWithCoach && (
                      <Badge variant="outline" className="ml-2">
                        Shared with coach
                      </Badge>
                    )}
                  </span>
                  <span className="flex gap-2">
                    <Link href={`/recovery?date=${e.date}`} className="underline underline-offset-4">
                      Edit
                    </Link>
                    <form action={deleteEntry}>
                      <input type="hidden" name="id" value={e.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Delete entry for ${e.date}`}>
                        Delete
                      </Button>
                    </form>
                  </span>
                </li>
              ))}
              {entries.length === 0 && <li className="p-3 text-muted-foreground">No entries yet.</li>}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section aria-labelledby="ready-h" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="ready-h" className="font-semibold text-brand-navy">
              Readiness today
            </h2>
            <div className="rounded-lg border-l-4 border-success bg-muted/40 p-3">
              <p className="font-semibold">{r.suggestion.title}</p>
              <p className="text-sm">{r.suggestion.detail}</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {r.suggestion.because.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
            <dl className="space-y-1 text-sm">
              {r.signals.map((s) => (
                <div key={s.key} className="flex items-baseline justify-between gap-2">
                  <dt>
                    {s.label}{" "}
                    <Badge variant="outline" className="text-[10px]">
                      {sourceLabel(s.source)}
                    </Badge>
                  </dt>
                  <dd className="font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
            {r.missing.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {r.missing.map((m) => (
                  <li key={m}>Missing: {m}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Not a readiness score and not a medical assessment. Pain that is sharp, swelling, or getting worse needs a
              doctor or physiotherapist.
            </p>
          </section>
          <nav aria-label="Recovery tools" className="space-y-1 rounded-xl border bg-card p-4 text-sm">
            <Link href="/strength" className="block underline underline-offset-4">
              Strength and mobility
            </Link>
            <Link href="/recovery/return-to-running" className="block underline underline-offset-4">
              Return to running after a break
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            Your journal is private. Entries are shared with your assigned coach only when you tick &ldquo;Share this
            entry&rdquo;. HYD Coach uses your fatigue, soreness and sleep scores to answer your questions.
          </p>
        </aside>
      </div>
    </>
  );
}
