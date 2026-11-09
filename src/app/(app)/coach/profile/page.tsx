import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ProfessionalProfileForm, RequestVerificationButton } from "@/features/coach-platform/components/forms";
import { VerificationBadge } from "@/features/coach-platform/components/verification-badge";
import { myProfessionalProfile } from "@/features/coach-platform/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Professional profile" };

export default async function CoachProfilePage() {
  const access = await requireRole(["coach", "mentor", "programme_manager", "admin"]);
  if (!access.allowed) return <AccessDenied area="The coach area" />;
  if (!access.user) return <AccessDenied area="The coach area" />;
  const profile = await myProfessionalProfile(await createClient(), access.user.id);
  return (
    <>
      <PageHeader title="Professional profile" description="Your coaching profile, credentials and verification." />
      <div className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <VerificationBadge status={profile?.verificationStatus ?? "unverified"} />
          <p className="text-sm">
            {profile?.verificationStatus === "verified"
              ? `Verified on ${profile.verifiedAt?.slice(0, 10)}.`
              : profile?.verificationStatus === "pending"
                ? "An administrator is reviewing your credentials."
                : "Your profile is shown as not verified until an administrator has checked your credentials."}
            {profile?.verificationNote && ` Note: ${profile.verificationNote}`}
          </p>
          {profile && (profile.verificationStatus === "unverified" || profile.verificationStatus === "rejected") && (
            <RequestVerificationButton />
          )}
        </div>
        <ProfessionalProfileForm profile={profile} />
      </div>
    </>
  );
}
