import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { ACTIVITY_TYPE_LABEL, km } from "@/features/activities/logic/format";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { cardDate } from "@/features/share/logic";
import { SocialButton } from "@/features/social/components/social-forms";
import { getRunnerProfile, visibleActivitiesOf } from "@/features/social/queries";

export const metadata: Metadata = { title: "Runner" };

export default async function RunnerPage({ params }: PageProps<"/runners/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Runner" />
        <RunnerPreviewNotice feature="runner profiles" />
      </>
    );
  const profile = await getRunnerProfile(ctx.supabase, id);
  if (!profile) notFound();
  const self = profile.id === ctx.user.id;
  const activities = profile.blockedByMe ? [] : await visibleActivitiesOf(ctx.supabase, id);

  return (
    <>
      <PageHeader title={profile.displayName} description={profile.bio ?? undefined} />
      <div className="max-w-2xl space-y-6">
        <p className="text-sm">
          {profile.followers} follower{profile.followers === 1 ? "" : "s"} · following {profile.following}
          {profile.followsMe ? " · follows you" : ""}
        </p>
        {self ? (
          <p className="text-sm">
            This is how other runners see you.{" "}
            <Link href="/runners" className="underline underline-offset-4">
              Social settings
            </Link>
          </p>
        ) : profile.blockedByMe ? (
          <div className="space-y-2">
            <p className="text-sm">You blocked this runner.</p>
            <SocialButton intent="unblock" fields={{ userId: id }} label="Unblock" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.myFollow === "none" ? (
              <SocialButton
                intent="follow"
                fields={{ userId: id }}
                label={profile.approveFollowers ? "Request to follow" : "Follow"}
                variant="default"
              />
            ) : (
              <SocialButton
                intent="unfollow"
                fields={{ userId: id }}
                label={profile.myFollow === "pending" ? "Cancel follow request" : "Unfollow"}
              />
            )}
            <SocialButton
              intent="block"
              fields={{ userId: id }}
              label="Block"
              variant="ghost"
              confirm={`Block ${profile.displayName}? They won't be able to see your activities, follow you or find you.`}
            />
          </div>
        )}
        {!profile.blockedByMe && (
          <section className="space-y-2" aria-labelledby="runner-activities">
            <h2 id="runner-activities" className="font-semibold text-brand-navy">
              Activities you can see
            </h2>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {profile.myFollow === "pending"
                  ? "Your follow request is waiting for approval."
                  : "Nothing shared with you yet."}
              </p>
            ) : (
              <ul aria-label="Runner activities" className="divide-y rounded-xl border bg-card px-4 text-sm">
                {activities.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3 py-2">
                    <Link href={`/activities/${a.id}`} className="font-medium text-brand-navy">
                      {a.name ?? ACTIVITY_TYPE_LABEL[a.activity_type]}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      {km(a.distance_m === null ? null : Number(a.distance_m))} · {cardDate(a.started_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
