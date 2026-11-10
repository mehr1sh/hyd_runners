import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { LiveRun } from "@/features/live/components/live-run";
import { liveState } from "@/features/live/queries";

export const metadata: Metadata = { title: "Live run" };

export default async function LivePage({ params }: PageProps<"/events/[id]/live">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="live group runs" />;
  const state = await liveState(ctx.supabase, id, ctx.user.id);
  if (!state) notFound();
  return (
    <>
      <PageHeader
        title={`Live: ${state.event.title}`}
        description="Opt-in location sharing for this run only. Off by default, time-limited, and visible only to the run's team."
      />
      <p className="mb-4 text-sm">
        <Link href={`/events/${id}`} className="underline underline-offset-4">
          Back to the run
        </Link>
      </p>
      {!state.isParticipant && !state.isStaff ? (
        <p className="rounded-xl border bg-card p-4 text-sm">
          Live tracking is for this run&apos;s participants and team. RSVP to join.
        </p>
      ) : (
        <LiveRun eventId={id} userId={ctx.user.id} initial={state} />
      )}
    </>
  );
}
