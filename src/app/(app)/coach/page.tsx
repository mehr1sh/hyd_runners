import type { Metadata } from "next";
import { Users } from "lucide-react";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { requireRole } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Coach" };

export default async function CoachPage() {
  const { allowed } = await requireRole(["coach", "mentor", "programme_manager", "admin"]);
  if (!allowed) return <AccessDenied area="The coach area" />;

  return (
    <>
      <PageHeader title="Coach" description="Runners assigned to you, their recent sessions and feedback." />
      <div className="space-y-6">
        <PlaceholderNotice feature="the coach and mentor view" owner="Community" />
        <EmptyState
          icon={Users}
          title="No runners assigned"
          description="When a programme manager assigns runners to you, their progress will appear here."
        />
      </div>
    </>
  );
}
