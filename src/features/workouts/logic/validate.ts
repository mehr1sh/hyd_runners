/**
 * Server-side validation for workout completion. Field shapes follow the
 * CompletedWorkout contract; these rules add plausibility checks so rewards
 * cannot be farmed with impossible entries.
 */
import { z } from "zod";
import { WorkoutType } from "@/lib/contracts";

export const MAX_BACKDATE_DAYS = 7;
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Fastest plausible average speeds (km/h) per activity type. */
export const MAX_SPEED_KMH: Partial<Record<z.infer<typeof WorkoutType>, number>> = {
  run: 22,
  walk_run: 18,
  walk: 9,
};

export const CompletionInput = z.object({
  durationMinutes: z.coerce
    .number()
    .int()
    .min(1, "Duration must be at least 1 minute.")
    .max(360, "Duration cannot exceed 6 hours."),
  distanceKm: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().min(0).max(100, "Distance cannot exceed 100 km.").nullable(),
  ),
  perceivedEffort: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int().min(1).max(10).nullable(),
  ),
  notes: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(1000).nullable()),
  locationId: z.preprocess((v) => (v ? v : null), z.uuid().nullable()),
});
export type CompletionInput = z.infer<typeof CompletionInput>;

export const ManualWorkoutInput = CompletionInput.extend({
  workoutType: WorkoutType.exclude(["rest"]),
  title: z.string().trim().min(1).max(120),
  startedAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.uuid(),
});
export type ManualWorkoutInput = z.infer<typeof ManualWorkoutInput>;

export function checkPlausibility(input: {
  workoutType: string;
  startedAt: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  now: Date;
  allowBackdate?: boolean;
}): string | null {
  const { startedAt, now } = input;
  if (startedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return "A workout cannot start in the future.";
  if (startedAt.getTime() + input.durationSeconds * 1000 > now.getTime() + FUTURE_TOLERANCE_MS)
    return "That workout would end in the future. Check the start time and duration.";
  if (!input.allowBackdate && now.getTime() - startedAt.getTime() > MAX_BACKDATE_DAYS * 86_400_000)
    return `Workouts can be logged up to ${MAX_BACKDATE_DAYS} days after they happen.`;
  const max = MAX_SPEED_KMH[input.workoutType as keyof typeof MAX_SPEED_KMH];
  if (max && input.distanceMeters) {
    const kmh = input.distanceMeters / 1000 / (input.durationSeconds / 3600);
    if (kmh > max) return `That pace (${kmh.toFixed(1)} km/h) is faster than we can accept for this activity.`;
  }
  return null;
}
