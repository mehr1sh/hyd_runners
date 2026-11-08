import "server-only";
import { TrainingProgramme, WorkoutBlock } from "@/lib/contracts";
import type { RunnerContext } from "@/features/dashboard/context";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { localDate } from "@/features/gamification/logic/time";
import { programmeProgress, type SessionRef } from "./logic/programme-progress";

export type ProgrammeCategory = "couch_to_5k" | "running" | "general_fitness" | "training_and_shine";

export type EnrollmentRow = {
  id: string;
  programmeId: string;
  status: "requested" | "active" | "paused" | "completed" | "withdrawn";
  startedAt: string | null;
  completedAt: string | null;
};

const PROGRAMME_COLUMNS =
  "id, slug, title, summary, kind, category, level, duration_weeks, sessions_per_week, enrolment, published, owner_id, sort_order";

function toProgramme(r: Record<string, unknown>) {
  const programme = TrainingProgramme.parse({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    kind: r.kind,
    level: r.level,
    durationWeeks: r.duration_weeks,
    sessionsPerWeek: r.sessions_per_week,
    published: r.published,
    ownerId: r.owner_id,
  });
  return {
    ...programme,
    category: r.category as ProgrammeCategory,
    enrolment: r.enrolment as "open" | "coach_approval",
  };
}
export type ProgrammeView = ReturnType<typeof toProgramme>;

async function myEnrollments(ctx: RunnerContext): Promise<EnrollmentRow[]> {
  const { data, error } = await ctx.supabase
    .from("enrollments")
    .select("id, programme_id, status, started_at, completed_at")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new DatabaseQueryError("enrollments", error);
  return (data ?? []).map((e) => ({
    id: e.id,
    programmeId: e.programme_id,
    status: e.status,
    startedAt: e.started_at,
    completedAt: e.completed_at,
  }));
}

/** The enrolment to show for a programme: an open one first, else the latest. */
function pickEnrollment(list: EnrollmentRow[], programmeId: string) {
  const mine = list.filter((e) => e.programmeId === programmeId);
  return mine.find((e) => ["active", "requested", "paused"].includes(e.status)) ?? mine[0] ?? null;
}

async function completedSessions(ctx: RunnerContext, enrollmentIds: string[]) {
  if (!enrollmentIds.length) return [];
  const { data, error } = await ctx.supabase
    .from("workout_logs")
    .select("enrollment_id, programme_session_id, started_at")
    .eq("status", "completed")
    .in("enrollment_id", enrollmentIds)
    .not("programme_session_id", "is", null);
  if (error) throw new DatabaseQueryError("workout_logs", error);
  return (data ?? []).map((r) => ({
    enrollmentId: r.enrollment_id as string,
    sessionId: r.programme_session_id as string,
    localDate: localDate(r.started_at, ctx.timezone),
  }));
}

function toSessionRefs(rows: Record<string, unknown>[]): SessionRef[] {
  return rows.map((s) => ({
    id: s.id as string,
    week: s.week as number,
    day: s.day as number,
    title: s.title as string,
    workoutType: s.workout_type as string,
    estimatedMinutes: s.estimated_minutes as number,
  }));
}

/** Catalogue with the runner's enrolment and progress per programme. */
export async function listProgrammes(ctx: RunnerContext) {
  const [{ data, error }, enrollments] = await Promise.all([
    ctx.supabase
      .from("programmes")
      .select(`${PROGRAMME_COLUMNS}, programme_sessions(id, week, day, title, workout_type, estimated_minutes)`)
      .eq("published", true)
      .order("sort_order"),
    myEnrollments(ctx),
  ]);
  if (error) throw new DatabaseQueryError("programmes", error);
  const done = await completedSessions(
    ctx,
    enrollments.map((e) => e.id),
  );

  return (data ?? []).map((row) => {
    const programme = toProgramme(row);
    const enrollment = pickEnrollment(enrollments, programme.id);
    const progress = enrollment
      ? programmeProgress({
          sessions: toSessionRefs(row.programme_sessions as Record<string, unknown>[]),
          completed: done.filter((d) => d.enrollmentId === enrollment.id),
          today: ctx.today,
          durationWeeks: programme.durationWeeks,
        })
      : null;
    return { programme, enrollment, progress };
  });
}

export type ProgrammeListItem = Awaited<ReturnType<typeof listProgrammes>>[number];

export async function getProgrammeDetail(ctx: RunnerContext, slug: string) {
  const { data, error } = await ctx.supabase
    .from("programmes")
    .select(
      `${PROGRAMME_COLUMNS}, programme_sessions(id, week, day, title, workout_type, estimated_minutes, blocks, instructions, is_milestone)`,
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const programme = toProgramme(data);
  const enrollments = await myEnrollments(ctx);
  const enrollment = pickEnrollment(enrollments, programme.id);
  const done = enrollment ? await completedSessions(ctx, [enrollment.id]) : [];

  const rawSessions = (data.programme_sessions as Record<string, unknown>[]).sort(
    (a, b) => (a.week as number) - (b.week as number) || (a.day as number) - (b.day as number),
  );
  const sessions = rawSessions.map((s) => ({
    ...toSessionRefs([s])[0],
    instructions: s.instructions as string,
    isMilestone: s.is_milestone as boolean,
    blocks: WorkoutBlock.array().catch([]).parse(s.blocks),
  }));
  const progress = enrollment
    ? programmeProgress({ sessions, completed: done, today: ctx.today, durationWeeks: programme.durationWeeks })
    : null;
  return { programme, enrollment, sessions, progress };
}
