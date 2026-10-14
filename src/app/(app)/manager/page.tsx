import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireRole } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Programme manager" };

const PANELS = [
  { value: "programmes", label: "Programmes", body: "Create and publish programmes and their weekly sessions." },
  { value: "events", label: "Events and places", body: "Schedule community events and verify running locations." },
  { value: "people", label: "People and roles", body: "Assign coaches and mentors, and grant staff roles." },
];

export default async function ManagerPage() {
  const { allowed } = await requireRole(["programme_manager", "admin"]);
  if (!allowed) return <AccessDenied area="Programme management" />;

  return (
    <>
      <PageHeader title="Programme manager" description="Run programmes, events and the coaching team." />
      <div className="space-y-6">
        <PlaceholderNotice feature="programme management" owner="Community" />
        <Tabs defaultValue="programmes">
          <TabsList>
            {PANELS.map((p) => (
              <TabsTrigger key={p.value} value={p.value}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {PANELS.map((p) => (
            <TabsContent key={p.value} value={p.value} className="pt-4">
              <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{p.body}</p>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}
