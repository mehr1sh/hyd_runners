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
  const { data: showcaseData } = await ctx.supabase.rpc("runner_showcase", { p_user: id });
  const showcase = showcaseData as Showcase | null;

  return (
    <>
      <PageHeader title={profile.displayName} description={profile.bio ?? undefined} />
      <div className="max-w-2xl space-y-6">
        {showcase && <ShowcaseView s={showcase} />}
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

type Showcase = {
  theme: "classic" | "night" | "sunrise" | "lake";
  badges: { code: string; title: string }[];
  routes: { slug: string; name: string; distanceM: number }[];
  clubs: { slug: string; name: string }[];
  races: { name: string; date: string; seconds: number | null; source: string }[] | null;
  bests: Record<string, number> | null;
};

const THEME_BAND = {
  classic: "bg-brand-navy-soft",
  night: "bg-[#0b0f1a] text-white",
  sunrise: "bg-[#ffe7c7]",
  lake: "bg-[#dff1f7]",
} as const;
const SOURCE = {
  organizer_verified: "organiser-verified",
  imported_activity: "from an activity",
  self_reported: "self-reported",
} as const;
const BEST = { "5k": "5 km", "10k": "10 km", half: "Half", marathon: "Marathon" } as const;

function clock(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function ShowcaseView({ s }: { s: Showcase }) {
  const empty =
    !s.badges.length && !s.routes.length && !s.clubs.length && !s.races?.length && !Object.keys(s.bests ?? {}).length;
  if (empty) return null;
  return (
    <section
      aria-label="Showcase"
      className={`space-y-2 rounded-xl p-4 text-sm ${THEME_BAND[s.theme] ?? THEME_BAND.classic}`}
    >
      {s.badges.length > 0 && <p>Badges: {s.badges.map((b) => b.title).join(" · ")}</p>}
      {s.clubs.length > 0 && (
        <p>
          Clubs:{" "}
          {s.clubs.map((c, i) => (
            <span key={c.slug}>
              {i > 0 && " · "}
              <Link href={`/clubs/${c.slug}`} className="underline underline-offset-4">
                {c.name}
              </Link>
            </span>
          ))}
        </p>
      )}
      {s.routes.length > 0 && (
        <p>
          Favourite routes:{" "}
          {s.routes.map((r, i) => (
            <span key={r.slug}>
              {i > 0 && " · "}
              <Link href={`/routes/${r.slug}`} className="underline underline-offset-4">
                {r.name}
              </Link>
            </span>
          ))}
        </p>
      )}
      {s.bests && Object.keys(s.bests).length > 0 && (
        <p>
          Best efforts (GPS):{" "}
          {Object.entries(s.bests)
            .map(([k, v]) => `${BEST[k as keyof typeof BEST] ?? k} ${clock(v)}`)
            .join(" · ")}
        </p>
      )}
      {s.races && s.races.length > 0 && (
        <ul aria-label="Race history">
          {s.races.map((r, i) => (
            <li key={i}>
              {r.name}, {String(r.date).slice(0, 10)}
              {r.seconds ? `: ${clock(r.seconds)}` : ""}{" "}
              <span className="opacity-70">({SOURCE[r.source as keyof typeof SOURCE] ?? r.source})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
