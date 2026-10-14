import type { Metadata } from "next";
import { Megaphone, MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Community" };

export default function CommunityPage() {
  return (
    <>
      <PageHeader title="Community" description="Announcements from coaches and a place to share feedback." />
      <div className="space-y-6">
        <PlaceholderNotice feature="announcements and feedback" owner="Community" />
        <Tabs defaultValue="announcements">
          <TabsList>
            <TabsTrigger value="announcements">Announcements</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
          </TabsList>
          <TabsContent value="announcements" className="pt-4">
            <EmptyState
              icon={Megaphone}
              title="No announcements yet"
              description="Coaches and programme managers will post updates here."
            />
          </TabsContent>
          <TabsContent value="feedback" className="pt-4">
            <EmptyState
              icon={MessageSquare}
              title="Feedback is coming soon"
              description="You will be able to rate sessions, events and coaching, and tell us what to improve."
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
