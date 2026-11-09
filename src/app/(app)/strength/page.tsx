import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { addDays } from "@/features/gamification/logic/time";
import { deleteStrengthLog } from "@/features/recovery/actions";
import { StrengthLogForm } from "@/features/recovery/components/forms";
import { MuscleMap } from "@/features/recovery/components/muscle-map";
import { muscleLoad } from "@/features/recovery/logic/muscles";
import { strengthLogs } from "@/features/recovery/server/queries";
import { STRENGTH_SESSIONS, type StrengthSessionKey } from "@/features/training/logic/strength-templates";

export const metadata: Metadata = { title: "Strength and mobility" };

export default async function StrengthPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Strength and mobility"
      description="Runner-focused sessions for core, glutes, hips, hamstrings and calves, plus mobility. Log what you did and see which muscles it worked."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="strength sessions" />
      </>
    );
  const { supabase, user, today } = ctx;
  const logs = await strengthLogs(supabase, user.id, addDays(today, -59));
  const recent = logs.filter((l) => l.performedOn >= addDays(today, -13));
  const load = muscleLoad(recent.map((l) => l.exercises));

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          {(Object.keys(STRENGTH_SESSIONS) as StrengthSessionKey[]).map((k) => (
            <details key={k} className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer">
                <span className="font-semibold">{STRENGTH_SESSIONS[k].title}</span>
                <span className="text-sm text-muted-foreground">
                  {" "}
                  · {STRENGTH_SESSIONS[k].focus} · about {STRENGTH_SESSIONS[k].minutes} min
                </span>
              </summary>
              <div className="mt-3">
                <StrengthLogForm sessionKey={k} today={today} minDate={addDays(today, -60)} />
              </div>
            </details>
          ))}
          <section aria-labelledby="slog-h" className="space-y-2">
            <h2 id="slog-h" className="font-semibold text-brand-navy">
              Your sessions (last 60 days)
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-medium">{l.performedOn}</span> · {l.title} · {l.minutes} min ·{" "}
                    {l.exercises.length} exercises
                  </span>
                  <form action={deleteStrengthLog}>
                    <input type="hidden" name="id" value={l.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${l.title} on ${l.performedOn}`}
                    >
                      Delete
                    </Button>
                  </form>
                </li>
              ))}
              {logs.length === 0 && <li className="p-3 text-muted-foreground">Nothing logged yet.</li>}
            </ul>
          </section>
        </div>
        <aside className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold text-brand-navy">Muscle map</h2>
          <MuscleMap load={load} days={14} />
        </aside>
      </div>
    </>
  );
}
