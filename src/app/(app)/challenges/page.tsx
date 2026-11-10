import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { ChallengeForm, JoinButton } from "@/features/challenges/components/challenge-forms";
import { CHALLENGE_KIND, percent, progressLabel } from "@/features/challenges/logic";
import { listChallenges, type Challenge, type ChallengeProgress } from "@/features/challenges/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Challenges" };

function ChallengeCard({ c, p, timezone }: { c: Challenge; p: ChallengeProgress | undefined; timezone: string }) {
  const shown = c.collective ? (p?.collectiveProgress ?? 0) : (p?.progress ?? 0);
  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-brand-navy">
            <Link href={`/challenges/${c.id}`} className="underline-offset-4 hover:underline">
              {c.title}
            </Link>
          </h3>
          <p className="text-xs text-muted-foreground">
            {CHALLENGE_KIND[c.kind].label}
            {c.collective ? " · group goal" : ""} · {c.scope === "club" ? "Club" : "City-wide"} · ends{" "}
            {formatDateTime(c.endsAt, timezone).split(",")[0]} · {p?.participants ?? 0} taking part
          </p>
        </div>
        <Badge variant="secondary">+{c.rewardXp} XP</Badge>
      </div>
      {(p?.joined || c.collective) && (
        <div className="space-y-1">
          <div
            className="h-2 rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent(shown, c.goal)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${c.title} progress`}
          >
            <div className="h-2 rounded-full bg-brand-red" style={{ width: `${percent(shown, c.goal)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {c.collective ? "Together: " : ""}
            {progressLabel(c.kind, shown, c.goal)}
          </p>
        </div>
      )}
      <JoinButton challengeId={c.id} joined={Boolean(p?.joined)} completed={Boolean(p?.completedAt)} />
    </li>
  );
}

export default async function ChallengesPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Challenges"
      description="City-wide and club challenges that reward showing up, not just speed or distance."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="challenges" />
      </>
    );
  // Pay out anything already finished (idempotent; computed from stored activity).
  const settled = await ctx.supabase.rpc("settle_my_challenges");
  if (settled.error) console.error("[challenges] settle failed", settled.error.code);
  const { open, past, progress } = await listChallenges(ctx.supabase, ctx.user.id);
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");

  return (
    <>
      {header}
      <div className="space-y-8">
        {open.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No open challenges"
            description="New challenges from the programme team and your clubs will appear here."
            action={
              <Button asChild variant="outline">
                <Link href="/dashboard">This week&apos;s challenges</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Open challenges">
            {open.map((c) => (
              <ChallengeCard key={c.id} c={c} p={progress.get(c.id)} timezone={ctx.timezone} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <section aria-labelledby="past" className="space-y-2">
            <h2 id="past" className="font-semibold text-brand-navy">
              Your past challenges
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {past.map((c) => {
                const p = progress.get(c.id);
                return (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2 p-3">
                    <Link href={`/challenges/${c.id}`} className="underline-offset-4 hover:underline">
                      {c.title}
                    </Link>
                    <span className="text-muted-foreground">
                      {p?.completedAt ? `Completed · +${c.rewardXp} XP` : "Not completed"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {isManager && (
          <section aria-labelledby="new" className="space-y-2">
            <h2 id="new" className="font-semibold text-brand-navy">
              Create a city-wide challenge
            </h2>
            <ChallengeForm clubId={null} today={ctx.today} />
          </section>
        )}
      </div>
    </>
  );
}
