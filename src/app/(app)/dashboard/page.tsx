import type { Metadata } from "next";
import Link from "next/link";
import { Activity, BedDouble, CalendarDays, Coins, Flame, MapPin, Sparkles, Target, Trophy } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressMeter } from "@/components/shared/progress-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime, formatLocalDate } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { loadDashboardState, type TodayActivity } from "@/features/dashboard/queries";
import { DashboardUnavailableNotice } from "@/features/dashboard/unavailable-notice";
import { loadDashboardExtras } from "@/features/dashboard/extras";
import { ACTIVITY_TYPE_LABEL, duration, km } from "@/features/activities/logic/format";
import { displayValue } from "@/features/challenges/logic";
import { ConditionsSummary } from "@/features/conditions/components/conditions-summary";
import { BadgeGrid, ChallengeList } from "@/features/gamification/components/achievement-panels";
import { CharacterAvatar } from "@/features/gamification/components/character-avatar";
import { PASSWORD_UPDATED_NOTICE } from "@/features/identity/logic/password-reset";
import { startWorkoutAction } from "@/features/workouts/actions";
import { ActionButton } from "@/features/workouts/components/action-form";

export const metadata: Metadata = { title: "Today" };

function TodayCard({ today, timezone }: { today: TodayActivity; timezone: string }) {
  switch (today.kind) {
    case "in_progress":
      return (
        <>
          <CardDescription>In progress</CardDescription>
          <p className="text-lg font-semibold text-brand-navy">{today.title}</p>
          <Button asChild>
            <Link href={`/workouts/${today.workoutId}`}>Continue workout</Link>
          </Button>
        </>
      );
    case "planned":
      return (
        <>
          <CardDescription>From your schedule · {formatDateTime(today.planned.startsAt, timezone)}</CardDescription>
          <p className="text-lg font-semibold text-brand-navy">{today.planned.title}</p>
          <ActionButton
            action={startWorkoutAction}
            fields={{ kind: "planned", plannedWorkoutId: today.planned.id }}
            label="Start workout"
          />
        </>
      );
    case "programme":
      return (
        <>
          <CardDescription>
            <Link href={`/programmes/${today.programmeSlug}`} className="underline-offset-4 hover:underline">
              {today.programmeTitle}
            </Link>{" "}
            · about {today.minutes} min
          </CardDescription>
          <p className="text-lg font-semibold text-brand-navy">{today.title}</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              action={startWorkoutAction}
              fields={{ kind: "programme", enrollmentId: today.enrollmentId, sessionId: today.sessionId }}
              label="Start session"
            />
            <Button asChild variant="ghost">
              <Link href={`/workouts/new?enrollment=${today.enrollmentId}&session=${today.sessionId}`}>
                Log it instead
              </Link>
            </Button>
          </div>
        </>
      );
    case "rest":
      return (
        <>
          <CardDescription className="flex items-center gap-2">
            <BedDouble className="size-4" aria-hidden /> Recovery day
          </CardDescription>
          <p className="text-lg font-semibold text-brand-navy">Rest is part of the plan</p>
          <p className="text-sm text-muted-foreground">
            {today.reason}
            {today.nextDate && <> Next session from {formatLocalDate(today.nextDate)}.</>} A gentle walk or stretch is
            fine.
          </p>
          <Button asChild variant="outline">
            <Link href="/programmes/mobility-basics">Try a short mobility session</Link>
          </Button>
        </>
      );
    case "done_today":
      return (
        <>
          <CardDescription>Done for today</CardDescription>
          <p className="text-lg font-semibold text-brand-navy">{today.title}</p>
          <Button asChild variant="outline">
            <Link href={`/workouts/${today.workoutId}`}>See what you earned</Link>
          </Button>
        </>
      );
    default:
      return (
        <>
          <CardDescription>Nothing planned yet</CardDescription>
          <p className="text-lg font-semibold text-brand-navy">Pick a programme to get a plan</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/programmes/couch-to-5k">Start Couch to 5K</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/workouts/new">Log a workout</Link>
            </Button>
          </div>
        </>
      );
  }
}

function PasswordUpdatedNotice() {
  return (
    <p role="status" className="mb-6 rounded-lg border border-input bg-card px-4 py-2 text-sm text-muted-foreground">
      <span className="font-semibold text-brand-navy">Password updated.</span> Any other devices signed in to your
      account have been signed out.
    </p>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { notice } = await searchParams;
  const passwordUpdated = notice === PASSWORD_UPDATED_NOTICE;
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Today" description="Your next session, this week's plan and your progress in one place." />
        <RunnerPreviewNotice feature="the runner dashboard" />
      </>
    );

  const state = await loadDashboardState(ctx);
  if (state.status === "schema_missing")
    return (
      <>
        <PageHeader title={`Hello, ${ctx.user.displayName}`} />
        {passwordUpdated && <PasswordUpdatedNotice />}
        <DashboardUnavailableNotice />
      </>
    );

  const d = state.data;
  const { summary, character, weekly, rank } = d.game;
  const x = await loadDashboardExtras(ctx);

  return (
    <>
      <PageHeader title={`Hello, ${ctx.user.displayName}`} description={d.message} />
      {passwordUpdated && <PasswordUpdatedNotice />}
      <div className="space-y-6">
        {ctx.isDemo && (
          <p
            role="note"
            className="rounded-lg border border-dashed border-input bg-card px-4 py-2 text-sm text-muted-foreground"
          >
            <span className="font-semibold text-brand-navy">Demo account.</span> This runner&apos;s history is simulated
            sample data for demonstrations.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="border-brand-red/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-4 text-brand-red" aria-hidden /> Today
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <TodayCard today={d.today} timezone={ctx.timezone} />
            </CardContent>
          </Card>
          {x.conditions ? (
            <ConditionsSummary
              forecast={x.conditions.forecast}
              rec={x.conditions.rec}
              aq={x.conditions.aq}
              placeName={x.conditions.place.name}
              compact
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Run now or later?</CardTitle>
                <CardDescription>The forecast is unavailable right now.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        <section aria-label="Your progress" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>This week</CardDescription>
              <CardTitle className="text-2xl">
                {d.game.week.activeDays}/{d.game.week.goalDays} days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress
                value={Math.min(100, (d.game.week.activeDays / d.game.week.goalDays) * 100)}
                className="h-2"
                aria-label="Weekly goal progress"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Weekly streak: {weekly.current} week{weekly.current === 1 ? "" : "s"} (best {weekly.longest})
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Flame className="size-4 text-brand-red" aria-hidden /> Habit streak
              </CardDescription>
              <CardTitle className="text-2xl">{summary.currentStreakDays} days</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Best {summary.longestStreakDays} days. One rest day between workouts keeps it going.
              {d.game.daily.atRisk && (
                <span className="mt-1 block font-medium text-brand-red-strong">Active today to keep it.</span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Trophy className="size-4 text-brand-navy" aria-hidden /> Level {summary.level} · {rank}
              </CardDescription>
              <CardTitle className="text-2xl">{summary.totalXp} XP</CardTitle>
            </CardHeader>
            <CardContent>
              <Progress
                value={(summary.xpIntoLevel / summary.xpForNextLevel) * 100}
                className="h-2"
                aria-label="Progress to next level"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {summary.xpForNextLevel - summary.xpIntoLevel} XP to level {summary.level + 1}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Coins className="size-4 text-brand-navy" aria-hidden /> Coins
              </CardDescription>
              <CardTitle className="text-2xl">{summary.coins}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Earned with workouts, plans and badges.</CardContent>
          </Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4 text-brand-red" aria-hidden /> Last 7 days
              </CardTitle>
              <CardDescription>From your imported activities.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!x.last7 ? (
                <p className="text-muted-foreground">Unavailable right now.</p>
              ) : x.last7.activities === 0 ? (
                <p className="text-muted-foreground">No imported activities this week.</p>
              ) : (
                <dl className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Distance</dt>
                    <dd className="text-lg font-semibold">{km(x.last7.distanceM)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Moving time</dt>
                    <dd className="text-lg font-semibold">{duration(x.last7.movingSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Active days</dt>
                    <dd className="text-lg font-semibold">{x.last7.activeDays}</dd>
                  </div>
                </dl>
              )}
              <Link href="/performance" className="underline underline-offset-4">
                Performance Lab
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!x.recent || x.recent.length === 0 ? (
                <p className="text-muted-foreground">
                  {x.recent ? "Import a GPX or FIT file from your watch or phone." : "Unavailable right now."}
                </p>
              ) : (
                <ul aria-label="Recent activities" className="divide-y">
                  {x.recent.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 py-2">
                      <Link href={`/activities/${a.id}`} className="font-medium text-brand-navy">
                        {a.name ?? ACTIVITY_TYPE_LABEL[a.type]}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">
                        {km(a.distanceM)}
                        {a.startedAt ? ` · ${formatLocalDate(a.startedAt.slice(0, 10))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/activities/import" className="underline underline-offset-4">
                Import an activity
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-brand-navy" aria-hidden /> Your challenges
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!x.challenges || x.challenges.length === 0 ? (
                <p className="text-muted-foreground">
                  {x.challenges ? "You haven’t joined a city or club challenge." : "Unavailable right now."}
                </p>
              ) : (
                <ul aria-label="Your challenges" className="space-y-3">
                  {x.challenges.map(({ challenge: c, progress: p }) => (
                    <li key={c.id} className="space-y-1">
                      <Link href={`/challenges/${c.id}`} className="font-medium text-brand-navy">
                        {c.title}
                      </Link>
                      <ProgressMeter
                        label={c.collective ? "Together" : "You"}
                        value={displayValue(c.kind, (c.collective ? p.collectiveProgress : p.progress) ?? 0)}
                        max={displayValue(c.kind, c.goal)}
                      />
                      {p.completedAt && <p className="text-xs text-muted-foreground">Completed ✓</p>}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/challenges" className="underline underline-offset-4">
                All challenges
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
              <CardDescription>Your next planned and programme sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing else lined up yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.upcoming.map((u) => (
                    <li key={u.key} className="flex justify-between gap-3 py-2">
                      <span className="font-medium text-brand-navy">
                        {u.href ? <Link href={u.href}>{u.title}</Link> : u.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {u.when ? formatLocalDate(u.when) : u.source}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-4 text-brand-navy" aria-hidden /> Upcoming community events
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events scheduled right now.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium text-brand-navy">{e.title}</span>
                      <span className="text-muted-foreground">{formatDateTime(e.startsAt, ctx.timezone)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button asChild variant="link" className="mt-2 px-0">
                <Link href="/events">All events</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {d.programmes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Goal progress</CardTitle>
              <CardDescription>Your active programmes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {d.programmes.map((p) => (
                <div key={p.programme.id} className="space-y-1">
                  <ProgressMeter label={p.programme.title} value={p.progress!.completed} max={p.progress!.total} />
                  <p className="text-xs text-muted-foreground">
                    Week {p.progress!.currentWeek} of {p.programme.durationWeeks}
                    {p.progress!.weeksCompleted.length > 0 &&
                      ` · ${p.progress!.weeksCompleted.length} week(s) complete`}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your character</CardTitle>
              <CardDescription>Evolves when you reach real milestones.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
              <CharacterAvatar stage={character.stage} className="size-24 shrink-0" />
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold text-brand-navy">
                    Stage {character.stage}: {character.name}
                  </span>
                  <span className="block text-muted-foreground">{character.description}</span>
                </p>
                {character.next && (
                  <div>
                    <p className="font-medium text-brand-navy">To reach {character.next.name}:</p>
                    <ul className="text-muted-foreground">
                      {character.next.requirements.map((r) => (
                        <li key={r.label}>
                          {r.done ? "✓" : "○"} {r.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand-red" aria-hidden /> This week&apos;s challenges
              </CardTitle>
              <CardDescription>Reset every Monday. Count towards the “Challenge accepted” badge.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChallengeList challenges={d.game.challenges} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Achievements</CardTitle>
            <CardDescription>
              {summary.recentBadges.length
                ? `${d.game.badgeCatalogue.filter((b) => b.earned).length} of ${d.game.badgeCatalogue.length} badges earned.`
                : "Your first workout earns your first badge."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BadgeGrid
              badges={[
                ...d.game.badgeCatalogue.filter((b) => b.earned),
                ...d.game.badgeCatalogue.filter((b) => !b.earned).slice(0, 4),
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
