import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { markAllRead } from "@/features/coach-platform/actions";
import { myNotifications } from "@/features/coach-platform/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Notifications"
      description="Feedback, proposals and replies from your coach and the community."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="notifications" />
      </>
    );
  const items = await myNotifications(ctx.supabase, ctx.user.id);
  return (
    <>
      {header}
      <div className="max-w-2xl space-y-3">
        {items.some((i) => !i.readAt) && (
          <form action={markAllRead}>
            <Button type="submit" variant="outline" size="sm">
              Mark all as read
            </Button>
          </form>
        )}
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You'll see coach feedback and replies here." />
        ) : (
          <ul aria-label="Notifications" className="divide-y rounded-xl border bg-card">
            {items.map((n) => (
              <li key={n.id} className={`p-3 text-sm ${n.readAt ? "" : "bg-brand-navy-soft"}`}>
                <p className="font-medium">
                  {n.href ? (
                    <Link href={n.href} className="underline-offset-4 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                  {!n.readAt && <span className="sr-only"> (unread)</span>}
                </p>
                {n.body && <p className="text-muted-foreground">{n.body}</p>}
                <p className="text-xs text-muted-foreground">{n.createdAt.slice(0, 16).replace("T", " ")} UTC</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
