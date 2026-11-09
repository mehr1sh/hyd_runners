import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { RoutePreview } from "@/components/shared/route-preview";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_TYPE_LABEL, VISIBILITY_LABEL, duration, km, pace } from "@/features/activities/logic/format";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { cardDate } from "@/features/share/logic";
import { SocialButton } from "@/features/social/components/social-forms";
import { loadFeed } from "@/features/social/queries";

export const metadata: Metadata = { title: "Feed" };

export default async function FeedPage({ searchParams }: PageProps<"/feed">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Feed"
      description="Activities from you and the runners you follow, as they chose to share them."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the feed" />
      </>
    );
  const sp = await searchParams;
  const before = typeof sp.before === "string" && !Number.isNaN(Date.parse(sp.before)) ? sp.before : null;
  const { items, nextBefore } = await loadFeed(ctx.supabase, before);

  return (
    <>
      {header}
      <div className="max-w-2xl space-y-4">
        <p className="text-sm">
          <Link href="/runners" className="underline underline-offset-4">
            Find runners to follow
          </Link>
        </p>
        {items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Your feed is empty"
            description="Follow runners, or share your own imported activities with followers or everyone."
          />
        ) : (
          <ul aria-label="Feed" className="space-y-3">
            {items.map((i) => {
              const own = i.userId === ctx.user.id;
              return (
                <li key={i.id} className="space-y-2 rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {own ? (
                          "You"
                        ) : (
                          <Link href={`/runners/${i.userId}`} className="underline-offset-4 hover:underline">
                            {i.authorName ?? "A runner"}
                          </Link>
                        )}{" "}
                        · {cardDate(i.startedAt)}
                      </p>
                      <h2 className="font-semibold text-brand-navy">
                        <Link href={`/activities/${i.id}`} className="underline-offset-4 hover:underline">
                          {i.name ?? ACTIVITY_TYPE_LABEL[i.type]}
                        </Link>
                      </h2>
                    </div>
                    {i.path && <RoutePreview coordinates={i.path} label={`Route of ${i.name ?? "the activity"}`} />}
                  </div>
                  <p className="text-sm">
                    {km(i.distanceM)} · {duration(i.movingSeconds)}
                    {i.type === "run" || i.type === "walk_run" ? ` · ${pace(i.avgPace)}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {own && <Badge variant="outline">{VISIBILITY_LABEL[i.visibility]}</Badge>}
                    <span>{i.kudos} kudos</span>
                    <Link href={`/activities/${i.id}#social`} className="underline underline-offset-4">
                      {i.comments} comment{i.comments === 1 ? "" : "s"}
                    </Link>
                    {!own &&
                      (i.myKudos ? (
                        <SocialButton intent="unkudos" fields={{ activityId: i.id }} label="Remove kudos" />
                      ) : (
                        <SocialButton
                          intent="kudos"
                          fields={{ activityId: i.id }}
                          label="Give kudos"
                          variant="default"
                        />
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {nextBefore && (
          <Link
            href={`/feed?before=${encodeURIComponent(nextBefore)}`}
            className="text-sm underline underline-offset-4"
          >
            Older activities
          </Link>
        )}
      </div>
    </>
  );
}
