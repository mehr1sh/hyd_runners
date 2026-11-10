import type { Metadata } from "next";
import { ShareCardPanel } from "@/features/share/components/share-card-panel";
import { safeFilename } from "@/features/share/logic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { CancelChallenge, JoinButton } from "@/features/challenges/components/challenge-forms";
import { CHALLENGE_KIND, displayValue, percent, progressLabel } from "@/features/challenges/logic";
import { getChallenge } from "@/features/challenges/queries";
import { CauseForm, VerifyCauseForm } from "@/features/experiments/components/forms";
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
  const { data: cause } = await ctx.supabase
    .from("challenges")
    .select("cause_name, cause_url, cause_status")
    .eq("id", id)
    .maybeSingle();
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
          {p?.completedAt && (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="share">
              <h2 id="share" className="font-semibold text-brand-navy">
                Share your achievement
              </h2>
              <ShareCardPanel
                endpoint={`/api/v1/challenges/${c.id}/card`}
                filename={safeFilename(c.title)}
                canHideRoute={false}
                canHidePace={false}
              />
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
          {(cause?.cause_name || canManage) && (
            <section aria-labelledby="cause-h" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
              <h2 id="cause-h" className="font-semibold text-brand-navy">
                Supporting a cause
              </h2>
              {cause?.cause_name ? (
                <p>
                  {cause.cause_url ? (
                    <a
                      href={cause.cause_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4"
                    >
                      {cause.cause_name}
                    </a>
                  ) : (
                    cause.cause_name
                  )}{" "}
                  <span className="text-muted-foreground">
                    {cause.cause_status === "verified" ? "· campaign verified by HYD Runners" : "· not yet verified"}
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground">No cause attached.</p>
              )}
              <p className="text-xs text-muted-foreground">
                HYD Runners doesn&apos;t collect or handle donations and makes no claims about money raised or impact.
              </p>
              {canManage && (
                <CauseForm challengeId={c.id} name={cause?.cause_name ?? ""} url={cause?.cause_url ?? ""} />
              )}
              {ctx.user.roles.includes("admin") && cause?.cause_status === "pending" && (
                <VerifyCauseForm challengeId={c.id} />
              )}
            </section>
          )}
          {canManage && c.status === "active" && <CancelChallenge challengeId={c.id} />}
          <Link href="/challenges" className="text-sm underline underline-offset-4">
            All challenges
          </Link>
        </aside>
      </div>
    </>
  );
}
