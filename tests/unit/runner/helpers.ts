import type { WorkoutFact } from "@/features/gamification/logic/types";

let n = 0;
/** A completed workout starting at a given IST wall-clock time. */
export function workout(istDateTime: string, minutes = 30, extra: Partial<WorkoutFact> = {}): WorkoutFact {
  const started = new Date(`${istDateTime}+05:30`);
  const completed = new Date(started.getTime() + minutes * 60_000);
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workoutType: "run",
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationSeconds: minutes * 60,
    distanceMeters: null,
    programmeSessionId: null,
    enrollmentId: null,
    plannedWorkoutId: null,
    plannedDate: null,
    ...extra,
  };
}
