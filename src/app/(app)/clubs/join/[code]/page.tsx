import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { JoinWithInvite } from "@/features/clubs/components/club-forms";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Club invite" };

export default async function JoinClubPage({ params }: PageProps<"/clubs/join/[code]">) {
  const { code } = await params;
  const ctx = await getRunnerContext();
  const header = <PageHeader title="You're invited to a club" description="Join with this invite link." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="club invites" />
      </>
    );
  const valid = /^[a-f0-9]{24}$/.test(code);
  return (
    <>
      {header}
      <div className="max-w-md space-y-3 rounded-xl border bg-card p-4 text-sm">
        {valid ? (
          <>
            <p>The club&apos;s members will see your display name. You can leave the club at any time.</p>
            <JoinWithInvite code={code} />
          </>
        ) : (
          <p role="alert">This invite link is invalid or has expired.</p>
        )}
      </div>
    </>
  );
}
