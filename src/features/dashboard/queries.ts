import "server-only";
import type { PlannedWorkout } from "@/lib/contracts";
import { listUpcomingEvents } from "@/features/community/queries";
import { motivationalMessage } from "@/features/gamification/logic/motivation";
import { addDays, localDate, localMidnightUtc } from "@/features/gamification/logic/time";
import { loadGamification } from "@/features/gamification/queries";
import { listPlannedWorkouts } from "@/features/workouts/planned-source";
import { listProgrammes } from "@/features/workouts/programme-queries";
import { countCompletedWorkouts, getInProgressWorkout, listCompletedWorkouts } from "@/features/workouts/queries";
import { DatabaseQueryError, isMissingSchemaError } from "@/lib/supabase/errors";
import type { RunnerContext } from "./context";

export type TodayActivity =
  | { kind: "in_progress"; workoutId: string; title: string }
  | { kind: "planned"; planned: PlannedWorkout }
  | {
      kind: "programme";
      enrollmentId: string;
      sessionId: string;
      title: string;
      programmeTitle: string;
      programmeSlug: string;
      minutes: number;
    }
  | { kind: "rest"; reason: string; nextDate: string | null; programmeSlug: string | null }
  | { kind: "done_today"; title: string; workoutId: string }
  | { kind: "none" };

export async function loadDashboard(ctx: RunnerContext) {
  // Recent workouts cover this week and today; lifetime figures come from the database.
  const [inProgress, completed, totalWorkouts, programmes, planned, events] = await Promise.all([
    getInProgressWorkout(ctx),
    listCompletedWorkouts(ctx, 200),
    countCompletedWorkouts(ctx),
    listProgrammes(ctx),
    listPlannedWorkouts(ctx.supabase, ctx.user.id, {
      from: localMidnightUtc(ctx.today, ctx.timezone),
      to: localMidnightUtc(addDays(ctx.today, 8), ctx.timezone),
    }),
    listUpcomingEvents(3),
  ]);
  const game = await loadGamification(ctx, completed);

  const completedPlannedIds = new Set(completed.map((w) => w.plannedWorkoutId).filter(Boolean));
  const openPlanned = planned.filter((p) => !completedPlannedIds.has(p.id) && p.status === "planned");
  const todayPlanned = openPlanned.filter((p) => localDate(p.startsAt, ctx.timezone) === ctx.today);
  const doneToday = completed.find((w) => localDate(w.startedAt, ctx.timezone) === ctx.today) ?? null;
  const active = programmes.filter((p) => p.enrollment?.status === "active" && p.progress && !p.progress.finished);

  let today: TodayActivity = { kind: "none" };
  const firstProgramme = active[0];
  if (inProgress) today = { kind: "in_progress", workoutId: inProgress.id, title: inProgress.title };
  else if (todayPlanned[0]) today = { kind: "planned", planned: todayPlanned[0] };
  else if (game.recovery.restRecommended)
    today = {
      kind: "rest",
      reason: "You have been active 6 of the last 7 days.",
      nextDate: addDays(ctx.today, 1),
      programmeSlug: null,
    };
  else if (firstProgramme?.progress?.next) {
    const p = firstProgramme.progress;
    if (p.restRecommended)
      today = doneToday
        ? { kind: "done_today", title: doneToday.title, workoutId: doneToday.id }
        : {
            kind: "rest",
            reason: `Rest day between ${firstProgramme.programme.title} sessions.`,
            nextDate: p.nextRecommendedDate,
            programmeSlug: firstProgramme.programme.slug,
          };
    else
      today = {
        kind: "programme",
        enrollmentId: firstProgramme.enrollment!.id,
        sessionId: p.next!.id,
        title: p.next!.title,
        programmeTitle: firstProgramme.programme.title,
        programmeSlug: firstProgramme.programme.slug,
        minutes: p.next!.estimatedMinutes,
      };
  } else if (doneToday) today = { kind: "done_today", title: doneToday.title, workoutId: doneToday.id };

  const upcoming = [
    ...openPlanned
      .filter((p) => !(today.kind === "planned" && today.planned.id === p.id))
      .map((p) => ({
        key: `planned:${p.id}`,
        title: p.title,
        when: localDate(p.startsAt, ctx.timezone),
        source: "Schedule",
        href: null as string | null,
      })),
    ...active.flatMap((a) =>
      a
        .progress!.upcoming.filter((s) => !(today.kind === "programme" && today.sessionId === s.id))
        .slice(0, 2)
        .map((s) => ({
          key: `session:${s.id}`,
          title: s.title,
          when: null as string | null,
          source: a.programme.title,
          href: `/programmes/${a.programme.slug}`,
        })),
    ),
  ].slice(0, 4);

  const message = motivationalMessage({
    totalWorkouts,
    workedOutToday: !!doneToday,
    streak: game.daily,
    restRecommended: game.recovery.restRecommended,
    weekActiveDays: game.week.activeDays,
    weeklyGoalDays: game.week.goalDays,
    nextSessionTitle: today.kind === "programme" ? today.title : null,
  });

  return {
    today,
    upcoming,
    game,
    programmes: active,
    allProgrammes: programmes,
    events,
    message,
    totalWorkouts,
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

export type DashboardState = { status: "ready"; data: DashboardData } | { status: "schema_missing"; source: string };

/**
 * loadDashboard for the page. When the database schema has not been deployed
 * (missing tables, columns or relationships) the dashboard cannot work at all,
 * so this returns an explicit `schema_missing` state and logs which relation
 * is missing instead of failing the whole render. Any other query failure is
 * rethrown for the route's error boundary.
 */
export async function loadDashboardState(ctx: RunnerContext): Promise<DashboardState> {
  try {
    return { status: "ready", data: await loadDashboard(ctx) };
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    const source = error instanceof DatabaseQueryError ? error.source : "unknown";
    console.error(
      `[dashboard] Database schema is not deployed (${source}): ${(error as Error).message}. ` +
        "Apply supabase/migrations to this project.",
    );
    return { status: "schema_missing", source };
  }
}
