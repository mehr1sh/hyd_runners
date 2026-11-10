import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventForm } from "@/features/community/components/manager-forms";
import { listLocations } from "@/features/community/queries";
import { listPeople } from "@/features/community/service";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { PaceGroupManager, Roster, TeamList, UpdateComposer } from "@/features/events/components/manage-panels";
import { ResultsImportForm, SponsorForm } from "@/features/passport/components/forms";
import { getEventDetail, getRoster } from "@/features/events/queries";
import { routeOptions } from "@/features/routes/queries";
import { MysteryForm } from "@/features/experiments/components/forms";

export const metadata: Metadata = { title: "Manage event" };

export default async function ManageEventPage({ params }: PageProps<"/events/[id]/manage">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Manage event" />
        <RunnerPreviewNotice feature="event management" />
      </>
    );
  const detail = await getEventDetail(ctx.supabase, id, ctx.user.id, ctx.user.roles);
  if (!detail) notFound();
  if (!detail.canStaff) return <AccessDenied area="Event management" />;

  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const [roster, locations, people, routes] = await Promise.all([
    getRoster(ctx.supabase, id),
    detail.canManage ? listLocations() : Promise.resolve([]),
    isManager ? listPeople(ctx.supabase, ctx.user.id) : Promise.resolve(null),
    detail.canManage ? routeOptions(ctx.supabase) : Promise.resolve([]),
  ]);
  const { event } = detail;
  const { data: taskRows } = await ctx.supabase.from("event_team").select("user_id, task").eq("event_id", event.id);
  const tasks = new Map(
    ((taskRows ?? []) as { user_id: string; task: string | null }[]).map((t) => [t.user_id, t.task]),
  );
  const { data: sponsorRows } = await ctx.supabase
    .from("event_sponsors")
    .select("name, tier")
    .eq("event_id", event.id)
    .order("tier");
  const sponsors = (sponsorRows ?? []) as { name: string; tier: string }[];
  const team = detail.team
    .filter((m): m is typeof m & { user_id: string } => m.user_id !== null)
    .map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role, task: tasks.get(m.user_id) ?? null }));
  const staff = people?.ok ? people.data.staff.map((p) => ({ id: p.id, displayName: p.displayName })) : null;

  return (
    <>
      <PageHeader
        title={`Manage: ${event.title}`}
        description={`${formatDateTime(event.startsAt, ctx.timezone)}. ${
          detail.canManage ? "You can edit this event." : "You can check people in."
        }`}
      />
      <p className="mb-4 text-sm">
        <Link href={`/events/${event.id}`} className="underline underline-offset-4">
          View the event page
        </Link>
      </p>
      <Tabs defaultValue="roster">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="roster">Roster and check-in</TabsTrigger>
            {detail.canManage && <TabsTrigger value="details">Details</TabsTrigger>}
            {detail.canManage && <TabsTrigger value="pace">Pace groups</TabsTrigger>}
            {detail.canManage && <TabsTrigger value="updates">Updates</TabsTrigger>}
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="raceday">Race day</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="roster" className="pt-4">
          <Roster eventId={event.id} roster={roster} paceGroups={detail.paceGroups} canManage={detail.canManage} />
        </TabsContent>
        {detail.canManage && (
          <TabsContent value="details" className="pt-4">
            <EventForm event={event} locations={locations} routes={routes} />
            <section className="mt-6 space-y-2">
              <h2 className="font-semibold text-brand-navy">Mystery run</h2>
              <p className="text-sm text-muted-foreground">
                Hide a published route until a reveal time. Runners see the distance; meeting point and safety details
                stay visible.
              </p>
              <MysteryForm eventId={event.id} routes={routes.map((r) => ({ id: r.id, name: r.name }))} current={null} />
            </section>
          </TabsContent>
        )}
        {detail.canManage && (
          <TabsContent value="pace" className="pt-4">
            <PaceGroupManager eventId={event.id} groups={detail.paceGroups} team={team} />
          </TabsContent>
        )}
        {detail.canManage && (
          <TabsContent value="updates" className="space-y-3 pt-4">
            <UpdateComposer eventId={event.id} />
            <p className="text-sm text-muted-foreground">
              {detail.updates.length} update{detail.updates.length === 1 ? "" : "s"} posted so far.
            </p>
          </TabsContent>
        )}
        <TabsContent value="raceday" className="space-y-6 pt-4">
          <section className="space-y-1 text-sm">
            <h2 className="font-semibold text-brand-navy">QR check-in</h2>
            <p>
              Runners with a place show a check-in code in their Race Passport. Scan it with your phone camera and
              confirm on the page that opens. Check-in opens two hours before the start.
            </p>
            <a href={`/api/v1/events/${event.id}/attendance`} className="underline underline-offset-4">
              Download attendance (CSV)
            </a>
          </section>
          {detail.canManage && (
            <>
              <section className="space-y-2">
                <h2 className="font-semibold text-brand-navy">Results</h2>
                <p className="text-sm text-muted-foreground">
                  Download the attendance file, fill in outcome and time, and paste the lines here. Results you record
                  are shown to runners as verified by the organiser.
                </p>
                <ResultsImportForm eventId={event.id} />
              </section>
              <section className="space-y-2">
                <h2 className="font-semibold text-brand-navy">Sponsors</h2>
                <ul className="text-sm">
                  {sponsors.map((sp) => (
                    <li key={sp.name}>
                      {sp.name} <span className="text-muted-foreground">· {sp.tier}</span>
                    </li>
                  ))}
                  {sponsors.length === 0 && <li className="text-muted-foreground">No sponsors listed.</li>}
                </ul>
                <SponsorForm eventId={event.id} />
              </section>
            </>
          )}
          <p className="text-xs text-muted-foreground">Payments and ticketing are not enabled.</p>
        </TabsContent>
        <TabsContent value="team" className="pt-4">
          <TeamList eventId={event.id} team={team} canManage={detail.canManage} staff={staff} />
          {!isManager && detail.canManage && (
            <p className="mt-2 text-sm text-muted-foreground">
              Add captains and sweepers from the roster. Programme managers add organisers.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
