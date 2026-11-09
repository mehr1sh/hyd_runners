import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClubAnnouncementForm,
  ClubForm,
  InviteCreator,
  InviteRow,
  MemberControls,
  RequestDecision,
} from "@/features/clubs/components/club-forms";
import { CLUB_ROLE_LABEL, inviteUrl } from "@/features/clubs/logic";
import { getClubPage, listInvites } from "@/features/clubs/queries";
import { EventForm } from "@/features/community/components/manager-forms";
import { listLocations } from "@/features/community/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { weekStart } from "@/features/gamification/logic/time";
import { SeriesForm } from "@/features/group-runs/components/series-forms";
import { ChallengeForm } from "@/features/challenges/components/challenge-forms";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Manage club" };

export default async function ManageClubPage({ params }: PageProps<"/clubs/[slug]/manage">) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Manage club" />
        <RunnerPreviewNotice feature="club management" />
      </>
    );
  const page = await getClubPage(ctx.supabase, slug, ctx.user.id, ctx.user.roles, {
    start: weekStart(ctx.today),
    timezone: ctx.timezone,
  });
  if (!page) notFound();
  if (!page.canLead) return <AccessDenied area="Club management" />;
  const { club } = page;
  const [invites, locations] = await Promise.all([
    page.canAdmin ? listInvites(ctx.supabase, club.id) : Promise.resolve([]),
    page.canAdmin ? listLocations() : Promise.resolve([]),
  ]);
  const pending = page.roster.filter((m) => m.status === "pending");
  const active = page.roster.filter((m) => m.status === "active");

  return (
    <>
      <PageHeader
        title={`Manage: ${club.name}`}
        description={page.canAdmin ? "You are a club admin." : "You are a club captain."}
      />
      <p className="mb-4 text-sm">
        <Link href={`/clubs/${club.slug}`} className="underline underline-offset-4">
          View the club page
        </Link>
      </p>
      <Tabs defaultValue="members">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="members">Members{pending.length ? ` (${pending.length} waiting)` : ""}</TabsTrigger>
            <TabsTrigger value="announcements">Announcements</TabsTrigger>
            {page.canAdmin && <TabsTrigger value="events">Club runs</TabsTrigger>}
            {page.canAdmin && <TabsTrigger value="series">Weekly runs</TabsTrigger>}
            {page.canAdmin && <TabsTrigger value="challenges">Challenges</TabsTrigger>}
            {page.canAdmin && <TabsTrigger value="invites">Invites</TabsTrigger>}
            {page.canAdmin && <TabsTrigger value="details">Details</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="members" className="space-y-4 pt-4">
          <section aria-labelledby="requests" className="space-y-2">
            <h2 id="requests" className="font-semibold text-brand-navy">
              Join requests
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests waiting.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Join requests">
                {pending.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      {m.displayName}{" "}
                      <span className="text-muted-foreground">
                        · asked {formatDateTime(m.requestedAt, ctx.timezone)}
                      </span>
                    </span>
                    <RequestDecision clubId={club.id} userId={m.userId} name={m.displayName} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="members" className="space-y-2">
            <h2 id="members" className="font-semibold text-brand-navy">
              Members ({active.length})
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Members">
              {active.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                  aria-label={m.displayName}
                >
                  <span>
                    {m.displayName} <span className="text-muted-foreground">· {CLUB_ROLE_LABEL[m.role]}</span>
                  </span>
                  {m.userId !== ctx.user.id && (page.canAdmin || m.role === "member") && (
                    <MemberControls
                      clubId={club.id}
                      userId={m.userId}
                      name={m.displayName}
                      role={m.role}
                      canAdmin={page.canAdmin}
                    />
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">A club always keeps at least one admin.</p>
          </section>
        </TabsContent>
        <TabsContent value="announcements" className="pt-4">
          <ClubAnnouncementForm clubId={club.id} />
        </TabsContent>
        {page.canAdmin && (
          <TabsContent value="events" className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground">
              Runs created here belong to the club. You can then add pace groups, captains and check-in from the
              run&apos;s page.
            </p>
            <EventForm locations={locations} clubId={club.id} />
          </TabsContent>
        )}
        {page.canAdmin && (
          <TabsContent value="series" className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground">
              A weekly run schedules itself four weeks ahead, with pace groups and a no-drop promise. Manage it from its
              page under Group runs.
            </p>
            <SeriesForm clubId={club.id} locations={locations} />
          </TabsContent>
        )}
        {page.canAdmin && (
          <TabsContent value="challenges" className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground">
              Club challenges are visible to and joinable by club members only.
            </p>
            <ChallengeForm clubId={club.id} today={ctx.today} />
          </TabsContent>
        )}
        {page.canAdmin && (
          <TabsContent value="invites" className="space-y-3 pt-4">
            <InviteCreator clubId={club.id} />
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active invite links.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card" aria-label="Invite links">
                {invites.map((i) => (
                  <InviteRow
                    key={i.id}
                    clubId={club.id}
                    inviteId={i.id}
                    url={inviteUrl(publicEnv.NEXT_PUBLIC_SITE_URL, i.code)}
                    label={`${i.uses}/${i.maxUses} used · expires ${formatDateTime(i.expiresAt, ctx.timezone)}`}
                  />
                ))}
              </ul>
            )}
          </TabsContent>
        )}
        {page.canAdmin && (
          <TabsContent value="details" className="pt-4">
            <ClubForm club={club} locations={locations} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
