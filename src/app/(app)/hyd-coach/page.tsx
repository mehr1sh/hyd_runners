import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { deleteConversation } from "@/features/hyd-coach/actions";
import { AskForm, SuggestedQuestion } from "@/features/hyd-coach/components/ask-form";
import { CoachMessageView } from "@/features/hyd-coach/components/message";
import { SUGGESTED_QUESTIONS } from "@/features/hyd-coach/logic/intent";
import { getConversation, listConversations, RETENTION_DAYS } from "@/features/hyd-coach/queries";

export const metadata: Metadata = { title: "HYD Coach" };

export default async function HydCoachPage({ searchParams }: PageProps<"/hyd-coach">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="HYD Coach"
      description="Ask about your running. Answers come from your own activities, plan and journal, and show what they're based on."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="HYD Coach" />
      </>
    );
  const sp = await searchParams;
  const selected = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  const [conversations, current] = await Promise.all([
    listConversations(ctx.supabase),
    selected ? getConversation(ctx.supabase, selected) : Promise.resolve(null),
  ]);

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-3" aria-label="Conversations">
          <Button asChild variant={current ? "outline" : "default"} className="w-full">
            <Link href="/hyd-coach">New conversation</Link>
          </Button>
          {conversations.length > 0 && (
            <nav>
              <ul className="space-y-1 text-sm">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/hyd-coach?c=${c.id}`}
                      aria-current={c.id === current?.id ? "page" : undefined}
                      className="block truncate rounded-md px-2 py-1.5 hover:bg-muted aria-[current=page]:bg-brand-navy-soft aria-[current=page]:font-semibold"
                    >
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <p className="text-xs text-muted-foreground">
            Conversations are private to you and deleted {RETENTION_DAYS} days after the last message. You can delete
            one at any time.
          </p>
        </aside>

        <section className="min-w-0 space-y-4" aria-label={current ? current.title : "New conversation"}>
          {selected && !current ? (
            <EmptyState
              icon={MessageCircleQuestion}
              title="Conversation not found"
              description="It may have been deleted or reached the end of its retention period."
            />
          ) : current ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="truncate font-semibold text-brand-navy">{current.title}</h2>
                <form action={deleteConversation}>
                  <input type="hidden" name="conversationId" value={current.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Delete conversation
                  </Button>
                </form>
              </div>
              <ol className="flex flex-col gap-3" aria-label="Messages">
                {current.messages.map((m, i) => (
                  <CoachMessageView key={m.id} message={m} latest={i === current.messages.length - 1} />
                ))}
              </ol>
              <AskForm conversationId={current.id} />
            </>
          ) : (
            <>
              <AskForm />
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">Try asking</h2>
                <ul className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <li key={q}>
                      <SuggestedQuestion question={q} />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            HYD Coach gives general training guidance, not medical advice. It can&apos;t diagnose injuries; for pain or
            symptoms, see a doctor or physiotherapist.
          </p>
        </section>
      </div>
    </>
  );
}
