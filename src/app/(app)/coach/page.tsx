import type { Metadata } from "next";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { FeedbackPanel } from "@/features/community/components/feedback-panel";
import { MessagePanel } from "@/features/community/components/message-panel";
import { listFeedback, listMessages, listRecipients } from "@/features/community/service";
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
        <PageHeader title="Coach" description="Feedback assigned to you, and messages with your runners." />
        <p className="text-sm text-muted-foreground">Sign in with Supabase configured to review assigned feedback.</p>
      </>
    );
  }

  const data = await load(user.id);
  const isManager = user.roles.includes("programme_manager") || user.roles.includes("admin");
  const visibleFeedback = data.feedback.ok
    ? data.feedback.data.filter((item) => isManager || item.assignedTo === user.id)
    : null;

  return (
    <>
      <PageHeader title="Coach" description="Feedback assigned to you, and messages with your runners." />
      <div className="space-y-8">
        {visibleFeedback ? (
          <FeedbackPanel items={visibleFeedback} mode="coach" />
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

async function load(userId: string) {
  const supabase = await createClient();
  const [feedback, messages, recipients] = await Promise.all([
    listFeedback(supabase, userId),
    listMessages(supabase, userId),
    listRecipients(supabase),
  ]);
  return { feedback, messages, recipients };
}
