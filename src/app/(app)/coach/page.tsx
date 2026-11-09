import type { Metadata } from "next";
import Link from "next/link";
import { coachRunnerList, type CoachRunner } from "@/features/coach-platform/queries";
import { km } from "@/features/activities/logic/format";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { FeedbackPanel } from "@/features/community/components/feedback-panel";
import { MessagePanel } from "@/features/community/components/message-panel";
import { listFeedback, listMessages, listRecipients } from "@/features/community/service";
import { getUserTimezone } from "@/features/gamification/service";
import { EnrollmentRequestsPanel } from "@/features/workouts/components/enrollment-requests-panel";
import { canReviewEnrollments, listEnrollmentRequests } from "@/features/workouts/enrollment-requests";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Coach" };

export default async function CoachPage() {
  const access = await requireRole(["coach", "mentor", "programme_manager", "admin"]);
  if (!access.allowed) return <AccessDenied area="The coach area" />;

  const user = access.user;
  if (!user) {
    return (
      <>
        <PageHeader
          title="Coach"
          description="Programme requests, feedback assigned to you, and messages with your runners."
        />
        <p className="text-sm text-muted-foreground">Sign in with Supabase configured to review assigned feedback.</p>
      </>
    );
  }

  const data = await load(user.id, canReviewEnrollments(user.roles));
  const isManager = user.roles.includes("programme_manager") || user.roles.includes("admin");
  const visibleFeedback = data.feedback.ok
    ? data.feedback.data.filter((item) => isManager || item.assignedTo === user.id)
    : null;

  return (
    <>
      <PageHeader
        title="Coach"
        description="Programme requests, feedback assigned to you, and messages with your runners."
      />
      <div className="space-y-8">
        <RunnersPanel runners={data.runners} />
        {data.requests && (
          <EnrollmentRequestsPanel
            requests={data.requests}
            timezone={data.timezone}
            scope={isManager ? "all" : "assigned"}
          />
        )}
        {visibleFeedback ? (
          <FeedbackPanel items={visibleFeedback} mode="coach" viewerId={user.id} />
        ) : (
          data.feedback.ok === false && <p className="text-sm text-destructive">{data.feedback.message}</p>
        )}
        {data.messages.ok && data.recipients.ok ? (
          <MessagePanel messages={data.messages.data} recipients={data.recipients.data} viewerId={user.id} />
        ) : (
          <p className="text-sm text-destructive">Could not load messages.</p>
        )}
      </div>
    </>
  );
}

async function load(userId: string, reviewsRequests: boolean) {
  const supabase = await createClient();
  const [feedback, messages, recipients, requests, timezone, runners] = await Promise.all([
    listFeedback(supabase, userId),
    listMessages(supabase, userId),
    listRecipients(supabase),
    // Mentors use this page too but do not approve programme places.
    reviewsRequests ? listEnrollmentRequests(supabase, userId) : null,
    getUserTimezone(supabase, userId),
    coachRunnerList(supabase).catch(() => [] as CoachRunner[]),
  ]);
  return { feedback, messages, recipients, requests, timezone, runners };
}

function RunnersPanel({ runners }: { runners: CoachRunner[] }) {
  return (
    <section aria-labelledby="runners-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="runners-h" className="text-lg font-semibold text-brand-navy">
          Your runners
        </h2>
        <span className="flex gap-3 text-sm">
          <Link href="/coach/profile" className="underline underline-offset-4">
            Your professional profile
          </Link>
          <Link href="/coach/services" className="underline underline-offset-4">
            Services and bookings
          </Link>
        </span>
      </div>
      {runners.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runners are assigned to you right now.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">Runner</th>
                <th className="p-2">Programme</th>
                <th className="p-2">Last 7 days</th>
                <th className="p-2">Sessions (28 days)</th>
                <th className="p-2">Race goal</th>
                <th className="p-2">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {runners.map((r) => (
                <tr key={r.runnerId} className="border-t">
                  <td className="p-2">
                    <Link
                      href={`/coach/runners/${r.runnerId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.displayName}
                    </Link>
                  </td>
                  <td className="p-2">{r.programme ?? "—"}</td>
                  <td className="p-2">{r.sharesTraining ? km(r.distance7dM) : "Not shared"}</td>
                  <td className="p-2">
                    {r.sharesTraining && r.planned28d !== null ? `${r.completed28d} of ${r.planned28d} done` : "—"}
                  </td>
                  <td className="p-2">{r.raceGoal ?? "—"}</td>
                  <td className="p-2">
                    {r.openProposals > 0 && `${r.openProposals} proposal${r.openProposals > 1 ? "s" : ""}`}
                    {r.openProposals > 0 && r.recentReplies > 0 && ", "}
                    {r.recentReplies > 0 && `${r.recentReplies} repl${r.recentReplies > 1 ? "ies" : "y"}`}
                    {r.openProposals + r.recentReplies === 0 && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
