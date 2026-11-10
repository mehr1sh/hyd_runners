import type { Metadata } from "next";
import { ghostComparison } from "@/features/experiments/logic";
import { RouteRecap } from "@/features/storytelling/components/route-recap";
import { ReflectionForm } from "@/features/storytelling/components/forms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RouteMap } from "@/components/map/route-map";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { ActivitySettings } from "@/features/activities/components/activity-settings";
import { ShareCardPanel } from "@/features/share/components/share-card-panel";
import { safeFilename } from "@/features/share/logic";
import { ACTIVITY_TYPE_LABEL, duration, km, pace } from "@/features/activities/logic/format";
import { PR_DISTANCES } from "@/features/activities/logic/normalize";
import { pacingAnalysis } from "@/features/activities/logic/performance";
import { routeMatches } from "@/features/activities/performance-queries";
import { getActivity } from "@/features/activities/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { ElevationProfile } from "@/features/routes/components/elevation-profile";
import { cardDate } from "@/features/share/logic";
import { CommentForm, ReportForm, SocialButton } from "@/features/social/components/social-forms";
import { activitySocial, getRunnerProfile } from "@/features/social/queries";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ params }: PageProps<"/activities/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Activity" />
        <RunnerPreviewNotice feature="activities" />
      </>
    );
  const page = await getActivity(ctx.supabase, id, ctx.user.id);
  if (!page) notFound();
  const { activity: a, own, track } = page;
  const { data: reflection } = await ctx.supabase
    .from("activity_reflections")
    .select("difficult, enjoyed, ran_with, achieved, story, share_story")
    .eq("activity_id", id)
    .maybeSingle();
  const title = a.name ?? ACTIVITY_TYPE_LABEL[a.type];
  const line = own ? (track?.path ?? a.publicPath) : a.publicPath;

  if (a.status !== "ready") {
    return (
      <>
        <PageHeader title={title} />
        <div className="max-w-xl space-y-3 rounded-xl border bg-card p-4 text-sm">
          {a.status === "failed" ? (
            <p role="alert">
              This import failed:{" "}
              {a.failureReason?.startsWith("duplicate:") ? (
                <>
                  it duplicates{" "}
                  <Link href={`/activities/${a.failureReason.slice(10)}`} className="underline underline-offset-4">
                    an activity you already imported
                  </Link>
                  .
                </>
              ) : a.failureReason === "internal" ? (
                "something went wrong while processing. Import the file again."
              ) : (
                a.failureReason
              )}
            </p>
          ) : (
            <p>This activity is still being processed.</p>
          )}
          {own && <ActivitySettings id={a.id} visibility={a.visibility} trim={a.privacyTrimM} name={a.name} />}
        </div>
      </>
    );
  }

  const stats: [string, string][] = [
    ["Distance", km(a.distanceM)],
    [a.movingSource === "device" ? "Moving time" : "Moving time (estimated)", duration(a.movingSeconds)],
    ["Elapsed time", duration(a.elapsedSeconds)],
    ["Average pace", pace(a.avgPace)],
    ["Elevation gain", a.elevationGain === null ? "Not in file" : `${Math.round(a.elevationGain)} m`],
  ];
  if (own && track?.avgHeartRate)
    stats.push(["Average heart rate", `${track.avgHeartRate} bpm (max ${track.maxHeartRate})`]);
  if (own && track?.avgCadence) stats.push(["Average cadence", `${track.avgCadence} spm`]);
  const splits = a.kmSplits ?? [];
  const pacing = pacingAnalysis(a.kmSplits);
  const matches = own && a.hasGps ? await routeMatches(ctx.supabase, a.id) : [];
  const others = matches.filter((m) => m.activityId !== a.id);
  // Ghost Runner: the most recent earlier effort on the matched route, if it has splits.
  const ghostMatch = [...others]
    .filter((m) => a.startedAt && m.startedAt < a.startedAt)
    .sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
  const ghostSplits = ghostMatch
    ? (((await ctx.supabase.from("activities").select("km_splits").eq("id", ghostMatch.activityId).maybeSingle()).data
        ?.km_splits as { index: number; seconds: number; partial: boolean }[] | null) ?? [])
    : [];
  const ghost = ghostMatch && a.kmSplits ? ghostComparison(a.kmSplits, ghostSplits) : null;
  const [social, author] = await Promise.all([
    activitySocial(ctx.supabase, a.id, ctx.user.id),
    own ? Promise.resolve(null) : getRunnerProfile(ctx.supabase, a.userId),
  ]);
  const fastest = splits
    .filter((s) => !s.partial)
    .reduce<number | null>((m, s) => (m === null || s.pace < m ? s.pace : m), null);

  return (
    <>
      <PageHeader
        title={title}
        description={
          own
            ? a.startedAt
              ? formatDateTime(a.startedAt, ctx.timezone)
              : undefined
            : // Others see the date only: start times reveal routines.
              `${author ? `By ${author.displayName} · ` : ""}${a.startedAt ? cardDate(a.startedAt) : ""}`
        }
      />
      {!own && author && (
        <p className="-mt-4 mb-4 text-sm">
          <Link href={`/runners/${author.id}`} className="underline underline-offset-4">
            View {author.displayName}&apos;s profile
          </Link>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {line && <RouteMap label={`Map of ${title}`} lines={[{ id: a.id, name: title, coordinates: line }]} />}
          {own && line && a.publicPath !== line && (
            <p className="text-xs text-muted-foreground">
              You see your full route. Others see it with the start and end hidden ({a.privacyTrimM} m).
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-semibold text-brand-navy">{v}</dd>
              </div>
            ))}
          </dl>
          {a.elevationProfile && <ElevationProfile profile={a.elevationProfile} />}
          {own && a.publicPath && a.publicPath.length > 1 && a.distanceM && a.movingSeconds && (
            <section className="space-y-2" aria-labelledby="recap">
              <h2 id="recap" className="font-semibold text-brand-navy">
                Recap
              </h2>
              <RouteRecap
                coordinates={a.publicPath}
                distanceM={a.distanceM}
                movingSeconds={a.movingSeconds}
                splits={splits.filter((x) => !x.partial).map((x) => ({ index: x.index, seconds: x.seconds }))}
              />
            </section>
          )}
          {splits.length > 0 && (
            <section className="space-y-2" aria-labelledby="splits">
              <h2 id="splits" className="font-semibold text-brand-navy">
                Kilometre splits
              </h2>
              <table className="w-full text-sm">
                <caption className="sr-only">Time and pace for each kilometre</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1">Km</th>
                    <th>Time</th>
                    <th>Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s) => (
                    <tr
                      key={s.index}
                      className={`border-t ${s.pace === fastest ? "font-semibold text-brand-navy" : ""}`}
                    >
                      <td className="py-1">{s.partial ? `${s.index} (${s.meters} m)` : s.index}</td>
                      <td>{formatDuration(s.seconds)}</td>
                      <td>
                        {pace(s.pace)}
                        {s.pace === fastest ? " · fastest" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {own && ghost && ghost.rows.length > 0 && ghostMatch && (
            <section className="space-y-2" aria-labelledby="ghost">
              <h2 id="ghost" className="font-semibold text-brand-navy">
                Ghost runner
              </h2>
              <p className="text-sm">
                Against your run on {ghostMatch.startedAt.slice(0, 10)} on the same route:{" "}
                <strong>
                  {ghost.final === null || ghost.final === 0
                    ? "level"
                    : `${formatDuration(Math.abs(ghost.final))} ${ghost.final < 0 ? "ahead" : "behind"}`}
                </strong>{" "}
                after {ghost.rows.at(-1)!.km} km.
              </p>
              <ul className="space-y-1 text-sm" aria-label="Ghost comparison by kilometre">
                {ghost.rows.map((r) => (
                  <li key={r.km} className="flex items-center gap-2">
                    <span className="w-12 text-muted-foreground">km {r.km}</span>
                    <span
                      aria-hidden
                      className={`h-2 rounded ${r.delta <= 0 ? "bg-success" : "bg-brand-red"}`}
                      style={{ width: `${Math.min(60, 4 + Math.abs(r.delta) / 2)}%` }}
                    />
                    <span>
                      {r.delta === 0
                        ? "level"
                        : `${formatDuration(Math.abs(r.delta))} ${r.delta < 0 ? "ahead" : "behind"}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Matched by start, finish and shape; GPS distance varies a little between runs.
              </p>
            </section>
          )}
          {own && others.length > 0 && (
            <section className="space-y-2" aria-labelledby="same-route">
              <h2 id="same-route" className="font-semibold text-brand-navy">
                Same route, other days
              </h2>
              <table className="w-full text-sm">
                <caption className="sr-only">Your activities on the same route</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1">Date</th>
                    <th>Distance</th>
                    <th>Time</th>
                    <th>Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr
                      key={m.activityId}
                      className={`border-t ${m.activityId === a.id ? "font-semibold text-brand-navy" : ""}`}
                    >
                      <td className="py-1">
                        {m.activityId === a.id ? (
                          "This run"
                        ) : (
                          <Link href={`/activities/${m.activityId}`} className="underline underline-offset-4">
                            {formatDateTime(m.startedAt, ctx.timezone).split(",")[0]}
                          </Link>
                        )}
                      </td>
                      <td>{km(m.distanceM)}</td>
                      <td>{duration(m.movingSeconds)}</td>
                      <td>{pace(m.avgPace)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Matched when both ends are within 200 m, the distance is within 5% and the paths never stray more than
                about 120 m apart.
              </p>
            </section>
          )}
        </div>
        <aside className="space-y-4">
          {pacing && (
            <section className="space-y-1 rounded-xl border bg-card p-4 text-sm" aria-labelledby="pacing">
              <h2 id="pacing" className="font-semibold text-brand-navy">
                Pacing
              </h2>
              <p>
                {pacing.kind === "negative"
                  ? "Negative split: your second half was faster."
                  : pacing.kind === "positive"
                    ? "Positive split: your second half was slower."
                    : "Even split: both halves at about the same pace."}
              </p>
              <p className="text-muted-foreground">
                First half {pace(pacing.firstHalfPace)}, second half {pace(pacing.secondHalfPace)} (
                {pacing.diffPct > 0 ? "+" : ""}
                {pacing.diffPct}%). Split paces were {pacing.consistency} (varying by {pacing.variationPct}%). Fastest
                km {pacing.fastest.index}, slowest km {pacing.slowest.index}.
              </p>
            </section>
          )}
          <section className="space-y-2 rounded-xl border bg-card p-4 text-sm" aria-labelledby="efforts">
            <h2 id="efforts" className="font-semibold text-brand-navy">
              Best efforts in this activity
            </h2>
            {Object.keys(a.bestEfforts).length === 0 ? (
              <p className="text-muted-foreground">Too short for a best effort.</p>
            ) : (
              <ul className="space-y-1">
                {PR_DISTANCES.filter((d) => a.bestEfforts[d.key]).map((d) => (
                  <li key={d.key}>
                    {d.label}: <span className="font-medium">{formatDuration(a.bestEfforts[d.key]!)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Measured from your GPS track, not an official race result.</p>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4 text-sm" aria-labelledby="social">
            <h2 id="social" className="font-semibold text-brand-navy">
              Kudos and comments
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span>{social.kudos} kudos</span>
              {!own &&
                (social.myKudos ? (
                  <SocialButton intent="unkudos" fields={{ activityId: a.id }} label="Remove kudos" />
                ) : (
                  <SocialButton intent="kudos" fields={{ activityId: a.id }} label="Give kudos" variant="default" />
                ))}
            </div>
            {social.comments.length > 0 && (
              <ul aria-label="Comments" className="space-y-3">
                {social.comments.map((c) => (
                  <li key={c.id} className="space-y-1 border-t pt-2">
                    <p className="text-xs text-muted-foreground">
                      {c.authorId === ctx.user.id ? "You" : (c.authorName ?? "A runner")} · {cardDate(c.createdAt)}
                      {c.hidden ? " · hidden by a moderator" : ""}
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    <div className="flex flex-wrap gap-2">
                      {(c.authorId === ctx.user.id || own) && (
                        <SocialButton
                          intent="delete_comment"
                          fields={{ commentId: c.id, activityId: a.id }}
                          label="Delete"
                          variant="ghost"
                          confirm="Delete this comment?"
                        />
                      )}
                      {c.authorId !== ctx.user.id && (
                        <ReportForm
                          targetType="activity_comment"
                          targetId={c.id}
                          activityId={a.id}
                          label="Report comment"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {(own || a.visibility !== "private") && <CommentForm activityId={a.id} />}
            {!own && (
              <ReportForm targetType="activity" targetId={a.id} activityId={a.id} label="Report this activity" />
            )}
          </section>
          <section className="space-y-1 rounded-xl border bg-card p-4 text-sm">
            <Badge variant="secondary">
              {a.format === "app" ? "Recorded in the app" : `${a.format?.toUpperCase()} import`}
            </Badge>
            {a.workoutLogId && <p className="text-muted-foreground">Counted once in your workouts and rewards.</p>}
          </section>
          {own && (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="share">
              <h2 id="share" className="font-semibold text-brand-navy">
                Share card
              </h2>
              <ShareCardPanel
                endpoint={`/api/v1/activities/${a.id}/card`}
                filename={safeFilename(a.name ?? `activity-${(a.startedAt ?? "").slice(0, 10)}`)}
                canHideRoute={Boolean(a.publicPath)}
                canHidePace={a.type === "run" || a.type === "walk_run"}
                themes
              />
            </section>
          )}
          {own && a.distanceM && a.movingSeconds ? (
            <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="story">
              <h2 id="story" className="font-semibold text-brand-navy">
                Your story
              </h2>
              <p className="text-xs text-muted-foreground">
                Private unless you choose to show it. Suggestions use only your answers and this activity&apos;s
                numbers.
              </p>
              <ReflectionForm
                activityId={a.id}
                stats={{
                  km: km(a.distanceM),
                  time: duration(a.movingSeconds),
                  type: ACTIVITY_TYPE_LABEL[a.type],
                  date: (a.startedAt ?? "").slice(0, 10),
                }}
                initial={{
                  difficult: reflection?.difficult ?? "",
                  enjoyed: reflection?.enjoyed ?? "",
                  ranWith: reflection?.ran_with ?? "",
                  achieved: reflection?.achieved ?? "",
                  story: reflection?.story ?? "",
                  share: reflection?.share_story ?? false,
                }}
              />
            </section>
          ) : null}
          {!own && reflection?.story && (
            <section className="space-y-1 rounded-xl border bg-card p-4 text-sm" aria-labelledby="story">
              <h2 id="story" className="font-semibold text-brand-navy">
                The runner&apos;s story
              </h2>
              <p className="whitespace-pre-line">{reflection.story}</p>
            </section>
          )}
          {own && <ActivitySettings id={a.id} visibility={a.visibility} trim={a.privacyTrimM} name={a.name} />}
          <Link href="/activities" className="text-sm underline underline-offset-4">
            All activities
          </Link>
        </aside>
      </div>
    </>
  );
}
