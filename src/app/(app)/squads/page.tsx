import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { CreateSquadForm, SquadButton } from "@/features/squads/components/forms";
import { mySquads } from "@/features/squads/queries";

export const metadata: Metadata = { title: "Squads" };

export default async function SquadsPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Squads"
      description="Small crews of two to eight runners with a shared weekly goal, a calendar and a chat. Consistency counts more than speed."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="squads" />
      </>
    );
  const { squads, openSquads } = await mySquads(ctx.supabase, ctx.user.id);
  const active = squads.filter((s) => s.myStatus === "active");
  const invited = squads.filter((s) => s.myStatus === "invited");
  const requested = squads.filter((s) => s.myStatus === "requested");
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {invited.length > 0 && (
            <section aria-labelledby="inv-h" className="space-y-2">
              <h2 id="inv-h" className="font-semibold text-brand-navy">
                Invitations
              </h2>
              <ul className="space-y-2">
                {invited.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="flex gap-2">
                      <SquadButton squadId={s.id} action="accept" label="Join" variant="default" />
                      <SquadButton squadId={s.id} action="decline" label="Decline" />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="mine-h" className="space-y-2">
            <h2 id="mine-h" className="font-semibold text-brand-navy">
              Your squads
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You&apos;re not in a squad yet. Create one, ask to join an open squad, or find partners through{" "}
                <Link href="/matching" className="underline underline-offset-4">
                  matching
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {active.map((s) => (
                  <li key={s.id} className="rounded-xl border bg-card p-3">
                    <Link href={`/squads/${s.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {s.name}
                    </Link>
                    {s.myRole === "captain" && (
                      <Badge variant="outline" className="ml-2">
                        Captain
                      </Badge>
                    )}
                    {s.weeklyKmTarget && (
                      <span className="block text-sm text-muted-foreground">Target {s.weeklyKmTarget} km a week</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {requested.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Waiting for approval: {requested.map((s) => s.name).join(", ")}
              </p>
            )}
          </section>
          <section aria-labelledby="open-h" className="space-y-2">
            <h2 id="open-h" className="font-semibold text-brand-navy">
              Open squads
            </h2>
            {openSquads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No squads are open to requests right now.</p>
            ) : (
              <ul className="space-y-2">
                {openSquads.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">{s.name}</span>
                      {s.description && <span className="block text-muted-foreground">{s.description}</span>}
                    </span>
                    <SquadButton squadId={s.id} action="request" label="Ask to join" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section aria-labelledby="new-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="new-h" className="font-semibold text-brand-navy">
            Start a squad
          </h2>
          <CreateSquadForm />
        </section>
      </div>
    </>
  );
}
