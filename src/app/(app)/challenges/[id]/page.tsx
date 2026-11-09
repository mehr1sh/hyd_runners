import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { CancelChallenge, JoinButton } from "@/features/challenges/components/challenge-forms";
import { CHALLENGE_KIND, displayValue, percent, progressLabel } from "@/features/challenges/logic";
import { getChallenge } from "@/features/challenges/queries";
import { myMemberships } from "@/features/clubs/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Challenge" };

export default async function ChallengePage({ params }: PageProps<"/challenges/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Challenge" />
        <RunnerPreviewNotice feature="challenges" />
      </>
    );
  const settled = await ctx.supabase.rpc("settle_my_challenges");
  if (settled.error) console.error("[challenges] settle failed", settled.error.code);
  const page = await getChallenge(ctx.supabase, id);
  if (!page) notFound();
  const { challenge: c, progress: p } = page;
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const clubAdmin = c.clubId
    ? (await myMemberships(ctx.supabase, ctx.user.id, [c.clubId])).get(c.clubId)?.role === "admin"
    : false;
  const canManage = isManager || clubAdmin;
  const ended = new Date(c.endsAt).getTime() <= page.now;
  const unit = CHALLENGE_KIND[c.kind].unit;

  return (
    <>
      <PageHeader title={c.title} description={CHALLENGE_KIND[c.kind].help} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{c.scope === "club" ? "Club challenge" : "City-wide"}</Badge>
            {c.collective && <Badge variant="outline">Group goal</Badge>}
            {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
            {ended && c.status !== "cancelled" && <Badge variant="outline">Ended</Badge>}
            {page.club && (
              <Badge variant="outline">
                <Link href={`/clubs/${page.club.slug}`}>{page.club.name}</Link>
              </Badge>
            )}
          </div>
          {c.description && <p className="text-sm whitespace-pre-wrap">{c.description}</p>}
          <p className="text-sm text-muted-foreground">
            {formatDateTime(c.startsAt, ctx.timezone).split(",")[0]} to{" "}
            {formatDateTime(new Date(new Date(c.endsAt).getTime() - 1).toISOString(), ctx.timezone).split(",")[0]} ·
            Reward: {c.rewardXp} XP{c.rewardCoins ? ` and ${c.rewardCoins} coins` : ""}
          </p>
          {p && (p.joined || c.collective) && (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Progress">
              {c.collective && (
                <>
                  <p className="text-sm font-medium">
                    Together: {progressLabel(c.kind, p.collectiveProgress ?? 0, c.goal)}
                  </p>
                  <div className="h-3 rounded-full bg-muted">
                    <div
                      className="h-3 rounded-full bg-brand-red"
                      style={{ width: `${percent(p.collectiveProgress ?? 0, c.goal)}%` }}
                    />
                  </div>
                </>
              )}
              {p.joined && (
                <p className="text-sm">
                  {c.collective ? "Your contribution: " : "Your progress: "}
                  {c.collective
                    ? `${displayValue(c.kind, p.progress ?? 0)} ${unit}`
                    : progressLabel(c.kind, p.progress ?? 0, c.goal)}
                  {p.completedAt ? " · completed ✓" : ""}
                </p>
              )}
            </section>
          )}
          {!ended && c.status === "active" && (
            <JoinButton challengeId={c.id} joined={Boolean(p?.joined)} completed={Boolean(p?.completedAt)} />
          )}
          <p className="text-xs text-muted-foreground">
            Counted from your logged and imported activities, each once. Activities under 10 minutes don&apos;t count,
            and logs added more than 3 days after the end are ignored.
          </p>
        </div>
        <aside className="space-y-4">
          <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="board">
            <h2 id="board" className="font-semibold text-brand-navy">
              {c.collective ? "Contributors" : "Leaderboard"}
            </h2>
            {page.leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has joined yet.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {page.leaderboard.map((r) => (
                  <li key={`${r.rank}-${r.displayName}`} className={r.isMe ? "font-semibold" : ""}>
                    {r.rank}. {r.displayName} · {displayValue(c.kind, r.progress)} {unit}
                    {r.completed ? " ✓" : ""}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">Runners who hide from leaderboards are not listed.</p>
          </section>
          {canManage && c.status === "active" && <CancelChallenge challengeId={c.id} />}
          <Link href="/challenges" className="text-sm underline underline-offset-4">
            All challenges
          </Link>
        </aside>
      </div>
    </>
  );
}
