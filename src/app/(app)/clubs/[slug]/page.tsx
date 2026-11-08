import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, Settings, Trophy, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MembershipButton } from "@/features/clubs/components/club-forms";
import { CLUB_ROLE_LABEL, JOIN_POLICY_LABEL } from "@/features/clubs/logic";
import { getClubPage } from "@/features/clubs/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { EVENT_CATEGORY_LABEL, type EventCategory } from "@/features/events/logic";
import { weekStart } from "@/features/gamification/logic/time";

export const metadata: Metadata = { title: "Club" };

export default async function ClubPage({ params }: PageProps<"/clubs/[slug]">) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Club" />
        <RunnerPreviewNotice feature="clubs" />
      </>
    );
  const page = await getClubPage(ctx.supabase, slug, ctx.user.id, ctx.user.roles, {
    start: weekStart(ctx.today),
    timezone: ctx.timezone,
  });
  if (!page) notFound();
  const { club, stats, membership } = page;
  const members = page.roster.filter((m) => m.status === "active");

  return (
    <>
      <PageHeader title={club.name} description={club.area ?? "Hyderabad running club"} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="About">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{JOIN_POLICY_LABEL[club.joinPolicy]}</Badge>
              {membership?.status === "active" && <Badge>{CLUB_ROLE_LABEL[membership.role]}</Badge>}
              {membership?.status === "pending" && <Badge variant="outline">Request sent</Badge>}
              {club.status === "archived" && <Badge variant="outline">Archived</Badge>}
            </div>
            {club.description && <p className="text-sm whitespace-pre-wrap">{club.description}</p>}
            {page.home && (
              <p className="text-sm">
                Home ground:{" "}
                <Link href={`/map?location=${page.home.id}`} className="underline underline-offset-4">
                  {page.home.name}
                </Link>
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-muted p-2">
                <dt className="text-xs text-muted-foreground">Members</dt>
                <dd className="text-lg font-semibold text-brand-navy">{stats.members}</dd>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <dt className="text-xs text-muted-foreground">Upcoming runs</dt>
                <dd className="text-lg font-semibold text-brand-navy">{stats.upcomingEvents}</dd>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <dt className="text-xs text-muted-foreground">Check-ins, 30 days</dt>
                <dd className="text-lg font-semibold text-brand-navy">{stats.attendedLast30Days}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-start gap-2">
              <MembershipButton clubId={club.id} joinPolicy={club.joinPolicy} membership={membership} />
              {page.canLead && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/clubs/${club.slug}/manage`}>
                    <Settings className="size-4" aria-hidden /> Manage club
                  </Link>
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-2" aria-labelledby="club-events">
            <h2 id="club-events" className="font-semibold text-brand-navy">
              Upcoming club runs
            </h2>
            {page.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs scheduled yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {page.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <Link
                      href={`/events/${e.id}`}
                      className="font-medium text-brand-navy underline-offset-4 hover:underline"
                    >
                      {e.title}
                    </Link>
                    <span className="text-muted-foreground">
                      {EVENT_CATEGORY_LABEL[e.category as EventCategory] ?? e.category} ·{" "}
                      {formatDateTime(e.startsAt, ctx.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(page.member || page.canAdmin) && (
            <section className="space-y-2" aria-labelledby="club-announcements">
              <h2 id="club-announcements" className="flex items-center gap-2 font-semibold text-brand-navy">
                <Megaphone className="size-4" aria-hidden /> Announcements
              </h2>
              {page.announcements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No announcements yet.</p>
              ) : (
                <ol className="space-y-2">
                  {page.announcements.map((a) => (
                    <li key={a.id} className="rounded-xl border bg-card p-3 text-sm">
                      <p className="font-medium text-brand-navy">{a.title}</p>
                      <p className="whitespace-pre-wrap">{a.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(a.createdAt, ctx.timezone)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {page.member ? (
            <>
              <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="club-board">
                <h2 id="club-board" className="flex items-center gap-2 font-semibold text-brand-navy">
                  <Trophy className="size-4" aria-hidden /> This week in the club
                </h2>
                {page.leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No workouts logged by members this week yet.</p>
                ) : (
                  <ol className="space-y-1 text-sm">
                    {page.leaderboard.map((r) => (
                      <li key={`${r.rank}-${r.displayName}`} className={r.isMe ? "font-semibold" : ""}>
                        {r.rank}. {r.displayName} · {r.xp} XP · {r.workouts} workouts
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">
                  Members who hide themselves from leaderboards are not listed.
                </p>
              </section>
              <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="club-members">
                <h2 id="club-members" className="flex items-center gap-2 font-semibold text-brand-navy">
                  <Users className="size-4" aria-hidden /> Members
                </h2>
                <ul className="space-y-1 text-sm">
                  {members.slice(0, 30).map((m) => (
                    <li key={m.userId}>
                      {m.displayName}
                      {m.role !== "member" ? (
                        <span className="text-muted-foreground"> · {CLUB_ROLE_LABEL[m.role]}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {members.length > 30 && <p className="text-xs text-muted-foreground">and {members.length - 30} more</p>}
              </section>
            </>
          ) : (
            <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
              Members see announcements, the member list and the weekly club board.
            </p>
          )}
          <Button asChild variant="link" className="px-0">
            <Link href="/clubs">All clubs</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
