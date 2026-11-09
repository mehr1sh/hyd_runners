import { EXERCISE_BY_KEY, MUSCLES, type Muscle } from "@/features/training/logic/strength-templates";

export type LoggedExercise = { key: string; sets: number };

/**
 * Muscles worked by logged exercises: primary muscles count each set once,
 * secondary muscles half. Exercises not in the catalogue are ignored, so the
 * map never claims a muscle the catalogue doesn't support.
 */
export function muscleLoad(logs: LoggedExercise[][]): Record<Muscle, number> {
  const load = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const log of logs)
    for (const e of log) {
      const ex = EXERCISE_BY_KEY.get(e.key);
      if (!ex) continue;
      const sets = Math.max(1, Math.min(10, Math.round(e.sets)));
      for (const m of ex.primary) load[m] += sets;
      for (const m of ex.secondary) load[m] += sets / 2;
    }
  return load;
}

/** 0–3 shade buckets for the map. */
export function shade(v: number) {
  if (v <= 0) return 0;
  if (v < 4) return 1;
  if (v < 10) return 2;
  return 3;
}
