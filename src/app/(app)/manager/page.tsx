import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditLogTable } from "@/features/community/components/audit-log-table";
import { FeedbackPanel } from "@/features/community/components/feedback-panel";
import {
  AnnouncementForm,
  EventForm,
  LocationForm,
  LocationUpdateForm,
  PeopleForms,
} from "@/features/community/components/manager-forms";
import { MessagePanel } from "@/features/community/components/message-panel";
import { ModerationQueue } from "@/features/community/components/moderation-queue";
import { listAuditLog, listReportQueue } from "@/features/community/moderation";
import {
  listAnnouncements,
  listFeedback,
  listLocationUpdates,
  listLocations,
  listManagedEvents,
  listMessages,
  listPeople,
  listRecipients,
} from "@/features/community/service";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Programme manager" };

const TABS = ["announcements", "events", "places", "feedback", "people", "reports", "messages", "audit"] as const;

export default async function ManagerPage({ searchParams }: PageProps<"/manager">) {
  const access = await requireRole(["programme_manager", "admin"]);
  if (!access.allowed) return <AccessDenied area="Programme management" />;

  const user = access.user;
  if (!user) {
    return (
      <>
        <PageHeader
          title="Programme manager"
          description="Publish announcements, events and location updates. Roles are checked on the server."
        />
        <p className="text-sm text-muted-foreground">Sign in with Supabase configured to manage the community.</p>
      </>
    );
  }

  const sp = await searchParams;
  const isAdmin = user.roles.includes("admin");
  const requestedTab = typeof sp.tab === "string" ? sp.tab : "";
  const tab =
    (TABS as readonly string[]).includes(requestedTab) && (requestedTab !== "audit" || isAdmin)
      ? requestedTab
      : "announcements";
  const auditBefore =
    typeof sp.auditBefore === "string" && /^\d{1,18}$/.test(sp.auditBefore) ? Number(sp.auditBefore) : undefined;
  const peopleQuery = typeof sp.people === "string" ? sp.people : "";
  const peoplePage = typeof sp.page === "string" && /^\d{1,4}$/.test(sp.page) ? Number(sp.page) : 0;
  const data = await load(user.id, isAdmin, auditBefore, { query: peopleQuery, page: peoplePage });

  return (
    <>
      <PageHeader
        title="Programme manager"
        description="Publish announcements, events and location updates. Roles are checked on the server."
      />
      <div className="space-y-6">
        <PlaceholderNotice feature="programme publishing">
          Creating training programmes stays with the training area. This page covers community management only.
        </PlaceholderNotice>
        <Tabs defaultValue={tab}>
          {/* Seven or eight tabs do not fit a phone; scroll instead of clipping the last ones. */}
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="announcements">Announcements</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="places">Places</TabsTrigger>
              <TabsTrigger value="feedback">Feedback</TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
              <TabsTrigger value="reports">
                Reports
                {data.reports.ok && data.reports.data.open.length > 0 ? ` (${data.reports.data.open.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              {isAdmin && <TabsTrigger value="audit">Audit log</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="announcements" className="space-y-4 pt-4">
            <AnnouncementForm />
            {data.announcements.ok &&
              data.announcements.data.map((item) => <AnnouncementForm key={item.id} announcement={item} />)}
          </TabsContent>
          <TabsContent value="events" className="space-y-4 pt-4">
            <EventForm locations={data.locations.ok ? data.locations.data : []} />
            {data.events.ok && (
              <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Managed events">
                {data.events.data.length === 0 && (
                  <li className="p-4 text-muted-foreground">No upcoming or recent events.</li>
                )}
                {data.events.data.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      <span className="font-medium text-brand-navy">{event.title}</span>{" "}
                      <span className="text-muted-foreground">
                        ·{" "}
                        {new Date(event.startsAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Kolkata",
                        })}{" "}
                        · {event.status}
                      </span>
                    </span>
                    <span className="flex gap-3">
                      <Link href={`/events/${event.id}/manage`} className="underline underline-offset-4">
                        Manage
                      </Link>
                      <Link href={`/events/${event.id}`} className="underline underline-offset-4">
                        View
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="places" className="space-y-4 pt-4">
            <LocationForm />
            <LocationUpdateForm locations={data.locations.ok ? data.locations.data : []} />
            {data.updates.ok &&
              data.updates.data.map((update) => (
                <LocationUpdateForm
                  key={update.id}
                  update={update}
                  locations={data.locations.ok ? data.locations.data : []}
                />
              ))}
          </TabsContent>
          <TabsContent value="feedback" className="pt-4">
            {data.feedback.ok ? (
              <FeedbackPanel
                items={data.feedback.data}
                mode="manager"
                viewerId={user.id}
                staff={(data.people.ok ? data.people.data.staff : []).filter((person) =>
                  person.roles.some((role) => role === "coach" || role === "mentor" || role === "programme_manager"),
                )}
              />
            ) : (
              <p className="text-sm text-destructive">{data.feedback.message}</p>
            )}
          </TabsContent>
          <TabsContent value="people" className="pt-4">
            {data.people.ok ? (
              <PeopleForms {...data.people.data} />
            ) : (
              <p className="text-sm text-destructive">{data.people.message}</p>
            )}
          </TabsContent>
          <TabsContent value="reports" className="pt-4">
            {data.reports.ok ? (
              <ModerationQueue
                open={data.reports.data.open}
                resolved={data.reports.data.resolved}
                moreOpen={data.reports.data.moreOpen}
                viewerId={user.id}
              />
            ) : (
              <p className="text-sm text-destructive">{data.reports.message}</p>
            )}
          </TabsContent>
          <TabsContent value="messages" className="pt-4">
            {data.messages.ok && data.recipients.ok ? (
              <MessagePanel messages={data.messages.data} recipients={data.recipients.data} viewerId={user.id} />
            ) : (
              <p className="text-sm text-destructive">Could not load messages.</p>
            )}
          </TabsContent>
          {isAdmin && (
            <TabsContent value="audit" className="pt-4">
              {data.audit?.ok ? (
                <AuditLogTable
                  entries={data.audit.data.entries}
                  nextBefore={data.audit.data.nextBefore}
                  paged={auditBefore !== undefined}
                />
              ) : (
                <p className="text-sm text-destructive">{data.audit?.message ?? "Could not load the audit log."}</p>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}

async function load(
  userId: string,
  isAdmin: boolean,
  auditBefore: number | undefined,
  peopleOptions: { query: string; page: number },
) {
  const supabase = await createClient();
  const [announcements, events, locations, updates, feedback, people, messages, recipients, reports, audit] =
    await Promise.all([
      listAnnouncements(supabase, userId),
      listManagedEvents(supabase),
      listLocations(supabase),
      listLocationUpdates(supabase),
      listFeedback(supabase, userId),
      listPeople(supabase, userId, peopleOptions),
      listMessages(supabase, userId),
      listRecipients(supabase),
      listReportQueue(supabase),
      isAdmin ? listAuditLog(supabase, { before: auditBefore }) : null,
    ]);
  return { announcements, events, locations, updates, feedback, people, messages, recipients, reports, audit };
}
