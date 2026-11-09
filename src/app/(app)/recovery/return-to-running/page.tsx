import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { ReturnToRunForm } from "@/features/recovery/components/forms";
import { RETURN_RULES, RETURN_WEEKS, sessionMinutes, sessionTitle } from "@/features/recovery/logic/return-to-run";

export const metadata: Metadata = { title: "Return to running" };

export default async function ReturnToRunningPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Return to running"
      description="A gradual walk-run progression for coming back after a break. General training guidance, not an injury rehabilitation plan."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="return to running" />
      </>
    );
  return (
    <>
      {header}
      <div className="max-w-3xl space-y-6">
        <div role="note" className="rounded-xl border border-brand-red/40 bg-brand-red-soft p-4 text-sm">
          If you&apos;re returning from an injury, your doctor or physiotherapist&apos;s plan comes first. This
          progression doesn&apos;t know about your injury and can&apos;t replace an individual rehabilitation programme.
        </div>
        <section aria-labelledby="weeks-h" className="space-y-2">
          <h2 id="weeks-h" className="font-semibold text-brand-navy">
            The progression
          </h2>
          <ol className="divide-y rounded-xl border bg-card text-sm">
            {RETURN_WEEKS.map((w) => (
              <li key={w.week} className="p-3">
                <span className="font-medium">Week {w.week}:</span> {sessionTitle(w).replace("Return to running: ", "")}
                , three times (about {sessionMinutes(w)} min with warm-up and cool-down)
                {w.note && <span className="block text-muted-foreground">{w.note}</span>}
              </li>
            ))}
          </ol>
          <ul className="list-disc pl-5 text-sm">
            {RETURN_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Runners who were running regularly before a short break start at week 3. Your assigned coach can see the
            proposal and accepted sessions.
          </p>
        </section>
        <section aria-labelledby="start-h" className="space-y-2 rounded-xl border bg-card p-4">
          <h2 id="start-h" className="font-semibold text-brand-navy">
            Start
          </h2>
          <p className="text-sm">
            This creates a proposal under Race prep. Nothing is added to your schedule until you accept it, and you can
            leave out any session.
          </p>
          <ReturnToRunForm />
        </section>
      </div>
    </>
  );
}
