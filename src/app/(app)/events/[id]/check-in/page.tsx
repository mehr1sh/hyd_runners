import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { CheckInForm } from "@/features/passport/components/forms";

export const metadata: Metadata = { title: "Check in" };

/** Opened by scanning a runner's QR code. Only the event's team can complete it. */
export default async function CheckInPage({ params, searchParams }: PageProps<"/events/[id]/check-in">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="check-in" />;
  const sp = await searchParams;
  const token = typeof sp.token === "string" && z.uuid().safeParse(sp.token).success ? sp.token : null;
  const { data: staff } = await ctx.supabase.rpc("can_staff_live", { p_event: id });
  return (
    <>
      <PageHeader
        title="Check in a runner"
        description="Scan a runner's Race Passport code with your phone camera to open this page."
      />
      <div className="max-w-md space-y-3 rounded-xl border bg-card p-4">
        {!staff ? (
          <p className="text-sm">Only this event&apos;s organisers, captains and sweepers can check runners in.</p>
        ) : !token ? (
          <p className="text-sm">This link has no check-in code. Scan the runner&apos;s code again.</p>
        ) : (
          <CheckInForm eventId={id} token={token} />
        )}
        <Link href={`/events/${id}/manage`} className="text-sm underline underline-offset-4">
          Back to managing the event
        </Link>
      </div>
    </>
  );
}
