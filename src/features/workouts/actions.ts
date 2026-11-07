"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PrivilegedAccessUnavailableError } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { WorkoutType } from "@/lib/contracts";
import {
  abandonWorkout,
  completeWorkout,
  logManualWorkout,
  startWorkout,
  WorkoutError,
  type StartTarget,
} from "./service";
import { CompletionInput, ManualWorkoutInput } from "./logic/validate";

export type ActionState = { status: "idle" | "error"; message?: string };

const RUNNER_PATHS = ["/dashboard", "/workouts", "/programmes", "/reports", "/community"];
function refresh() {
  for (const p of RUNNER_PATHS) revalidatePath(p, "layout");
}

async function requireUserId() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.id;
}

function errorState(e: unknown): ActionState {
  if (e instanceof WorkoutError) return { status: "error", message: e.message };
  if (e instanceof PrivilegedAccessUnavailableError)
    return { status: "error", message: "Saving workouts is not available on this deployment." };
  console.error(e);
  return { status: "error", message: "Something went wrong. Please try again." };
}

const StartForm = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("programme"), enrollmentId: z.uuid(), sessionId: z.uuid() }),
  z.object({ kind: z.literal("planned"), plannedWorkoutId: z.uuid() }),
  z.object({
    kind: z.literal("free"),
    workoutType: WorkoutType.exclude(["rest"]),
    title: z.string().trim().min(1).max(120),
  }),
]);

export async function startWorkoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = StartForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "That workout could not be started." };
  let workoutId: string;
  try {
    ({ workoutId } = await startWorkout(userId, parsed.data as StartTarget));
  } catch (e) {
    return errorState(e);
  }
  refresh();
  redirect(`/workouts/${workoutId}`);
}

export async function completeWorkoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const id = z.uuid().safeParse(formData.get("workoutId"));
  const parsed = CompletionInput.safeParse(Object.fromEntries(formData));
  if (!id.success) return { status: "error", message: "Workout not found." };
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  try {
    await completeWorkout(userId, id.data, parsed.data);
  } catch (e) {
    return errorState(e);
  }
  refresh();
  redirect(`/workouts/${id.data}?completed=1`);
}

const LinkForm = z
  .object({
    linkKind: z.enum(["none", "programme", "planned"]).default("none"),
    enrollmentId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    plannedWorkoutId: z.uuid().optional(),
  })
  .transform((v): StartTarget | undefined =>
    v.linkKind === "programme" && v.enrollmentId && v.sessionId
      ? { kind: "programme", enrollmentId: v.enrollmentId, sessionId: v.sessionId }
      : v.linkKind === "planned" && v.plannedWorkoutId
        ? { kind: "planned", plannedWorkoutId: v.plannedWorkoutId }
        : undefined,
  );

export async function logManualWorkoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const raw = Object.fromEntries(formData);
  // <input type="datetime-local"> has no offset; the form sends the browser's offset.
  const startedAt =
    typeof raw.startedAtLocal === "string" && raw.startedAtLocal
      ? `${raw.startedAtLocal}:00${raw.tzOffset ?? "+05:30"}`
      : "";
  const parsed = ManualWorkoutInput.safeParse({ ...raw, startedAt });
  const link = LinkForm.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  let workoutId: string;
  try {
    ({ workoutId } = await logManualWorkout(userId, { ...parsed.data, link: link.success ? link.data : undefined }));
  } catch (e) {
    return errorState(e);
  }
  refresh();
  redirect(`/workouts/${workoutId}?completed=1`);
}

export async function abandonWorkoutAction(formData: FormData) {
  const userId = await requireUserId();
  const id = z.uuid().safeParse(formData.get("workoutId"));
  if (id.success) await abandonWorkout(userId, id.data);
  refresh();
  redirect("/workouts");
}

/** Enrol in a programme. Open programmes start immediately; coach-led ones become a request. */
export async function enrollAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const programmeId = z.uuid().safeParse(formData.get("programmeId"));
  const slug = z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .safeParse(formData.get("slug"));
  if (!programmeId.success || !slug.success) return { status: "error", message: "Programme not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("enrollments").insert({ user_id: userId, programme_id: programmeId.data });
  if (error && error.code !== "23505") {
    console.error(error);
    return { status: "error", message: "Could not enrol. Please try again." };
  }
  refresh();
  redirect(`/programmes/${slug.data}`);
}

export async function leaveProgrammeAction(formData: FormData) {
  await requireUserId();
  const enrollmentId = z.uuid().safeParse(formData.get("enrollmentId"));
  const status = z.enum(["paused", "withdrawn", "active"]).safeParse(formData.get("status"));
  if (enrollmentId.success && status.success) {
    const supabase = await createClient();
    await supabase.from("enrollments").update({ status: status.data }).eq("id", enrollmentId.data);
  }
  refresh();
}
