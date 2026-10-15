import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedbackPanel } from "@/features/community/components/feedback-panel";
import {
  AnnouncementForm,
  EventForm,
  LocationForm,
  LocationUpdateForm,
  PeopleForms,
} from "@/features/community/components/manager-forms";
import { MessagePanel } from "@/features/community/components/message-panel";
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

export default async function ManagerPage() {
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

  const data = await load(user.id);

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
        <Tabs defaultValue="announcements">
          {/* Six tabs do not fit a phone; scroll instead of clipping the last ones. */}
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="announcements">Announcements</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="places">Places</TabsTrigger>
              <TabsTrigger value="feedback">Feedback</TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="announcements" className="space-y-4 pt-4">
            <AnnouncementForm />
            {data.announcements.ok &&
              data.announcements.data.map((item) => <AnnouncementForm key={item.id} announcement={item} />)}
          </TabsContent>
          <TabsContent value="events" className="space-y-4 pt-4">
            <EventForm locations={data.locations.ok ? data.locations.data : []} />
            {data.events.ok &&
              data.events.data.map((event) => (
                <EventForm key={event.id} event={event} locations={data.locations.ok ? data.locations.data : []} />
              ))}
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
                staff={(data.people.ok ? data.people.data.people : []).filter((person) =>
                  person.roles.some((role) => role === "coach" || role === "mentor" || role === "programme_manager"),
                )}
              />
            ) : (
              <p className="text-sm text-destructive">{data.feedback.message}</p>
            )}
          </TabsContent>
          <TabsContent value="people" className="pt-4">
            {data.people.ok ? (
              <PeopleForms people={data.people.data.people} assignments={data.people.data.assignments} />
            ) : (
              <p className="text-sm text-destructive">{data.people.message}</p>
            )}
          </TabsContent>
          <TabsContent value="messages" className="pt-4">
            {data.messages.ok && data.recipients.ok ? (
              <MessagePanel messages={data.messages.data} recipients={data.recipients.data} viewerId={user.id} />
            ) : (
              <p className="text-sm text-destructive">Could not load messages.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

async function load(userId: string) {
  const supabase = await createClient();
  const [announcements, events, locations, updates, feedback, people, messages, recipients] = await Promise.all([
    listAnnouncements(supabase, userId),
    listManagedEvents(supabase),
    listLocations(supabase),
    listLocationUpdates(supabase),
    listFeedback(supabase, userId),
    listPeople(supabase, userId),
    listMessages(supabase, userId),
    listRecipients(supabase),
  ]);
  return { announcements, events, locations, updates, feedback, people, messages, recipients };
}
