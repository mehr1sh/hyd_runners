import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { GpxUploadForm } from "@/features/routes/components/route-forms";

export const metadata: Metadata = { title: "Contribute a route" };

export default async function NewRoutePage() {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Contribute a route" description="Upload a GPX track you recorded." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="route uploads" />
      </>
    );
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const { count, error } = await ctx.supabase
    .from("club_members")
    .select("club_id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("role", "admin")
    .eq("status", "active");
  if (error) throw new Error(`Could not check club roles: ${error.message}`);
  if (!isManager && !count) return <AccessDenied area="Route contributions" />;
  return (
    <>
      {header}
      <div className="max-w-xl">
        <GpxUploadForm canPublish={isManager} />
      </div>
    </>
  );
}
