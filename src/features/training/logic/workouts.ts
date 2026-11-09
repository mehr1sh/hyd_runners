import type { FitnessLevel } from "@/lib/contracts";
import { clock, type TrainingPaces } from "./pace";

/**
 * Structured session generator. Every workout has a warm-up, a main set
 * (with recoveries where relevant), a cool-down, an expected duration and
 * intensity guidance in effort terms, plus pace ranges when the runner has a
 * reference effort. Volumes scale with the runner's level so a beginner never
 * gets an advanced session.
 */

export const WORKOUT_KINDS = ["easy", "recovery", "long", "tempo", "intervals", "progression", "hills"] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];

export const KIND_LABEL: Record<WorkoutKind, string> = {
  easy: "Easy run",
  recovery: "Recovery run",
  long: "Long run",
  tempo: "Tempo run",
  intervals: "Intervals",
  progression: "Progression run",
  hills: "Hill repeats",
};

export const QUALITY_KINDS: readonly WorkoutKind[] = ["tempo", "intervals", "progression", "hills"];

export type Step = {
  label: string;
  reps?: number;
  /** Work per rep (or the whole step), in minutes or metres. */
  minutes?: number;
  meters?: number;
  recovery?: string;
  effort: string;
  pace?: string;
};

export type WorkoutDetails = {
  kind: WorkoutKind;
  title: string;
  warmup: Step;
  main: Step[];
  cooldown: Step;
  totalMinutes: number;
  intensity: string;
  notes: string[];
};

const EFFORT = {
  recovery: "Very easy, you could chat in full sentences (about 2 of 10)",
  easy: "Easy and conversational (3–4 of 10)",
  steady: "Steady, a little harder than easy (5 of 10)",
  tempo: "Comfortably hard, a few words at a time (6–7 of 10)",
  interval: "Hard but controlled, same pace on every rep (8 of 10)",
  hill: "Strong uphill effort with good form (8 of 10)",
};

const range = (r?: [number, number]) => (r ? `${clock(r[0])}–${clock(r[1])} /km` : undefined);

type Opts = { level: FitnessLevel; minutes: number; paces?: TrainingPaces | null };

export function generateWorkout(kind: WorkoutKind, { level, minutes, paces }: Opts): WorkoutDetails {
  const beginner = level === "new_to_running";
  const warm = (m: number): Step => ({
    label: "Warm-up",
    minutes: m,
    effort: beginner ? "Brisk walk, then easy jog" : EFFORT.easy,
    pace: range(paces?.easy),
  });
  const cool = (m: number): Step => ({ label: "Cool-down", minutes: m, effort: "Easy jog or walk", pace: undefined });
  const notes: string[] = [];
  if (!paces) notes.push("No recent 5 km or longer GPS effort, so effort levels are given instead of paces.");
  else notes.push(`Paces from ${paces.basis}. Run by effort on hot or hilly days.`);

  const continuous = (k: "easy" | "recovery" | "long", eff: string, p?: [number, number]): WorkoutDetails => {
    const total = Math.max(15, minutes);
    const run: Step = beginner
      ? {
          label: "Run/walk",
          minutes: total - 10,
          effort: `${eff}. Walk for a minute whenever you need to.`,
          pace: range(p),
        }
      : { label: KIND_LABEL[k], minutes: total - 10, effort: eff, pace: range(p) };
    return {
      kind: k,
      title: KIND_LABEL[k],
      warmup: { ...warm(5), effort: "Start slower than you want to" },
      main: [run],
      cooldown: cool(5),
      totalMinutes: total,
      intensity: eff,
      notes,
    };
  };

  switch (kind) {
    case "easy":
      return continuous("easy", EFFORT.easy, paces?.easy);
    case "recovery":
      return continuous("recovery", EFFORT.recovery, paces?.recovery);
    case "long":
      return continuous("long", EFFORT.easy, paces?.long);
    case "tempo": {
      const main: Step = beginner
        ? {
            label: "Tempo blocks",
            reps: 3,
            minutes: 4,
            recovery: "2 min walk or jog",
            effort: EFFORT.tempo,
            pace: range(paces?.tempo),
          }
        : level === "returning"
          ? {
              label: "Tempo blocks",
              reps: 2,
              minutes: 8,
              recovery: "2 min easy jog",
              effort: EFFORT.tempo,
              pace: range(paces?.tempo),
            }
          : {
              label: "Tempo",
              minutes: Math.min(30, Math.max(15, minutes - 25)),
              effort: EFFORT.tempo,
              pace: range(paces?.tempo),
            };
      const mainMin = (main.reps ?? 1) * (main.minutes ?? 0) + ((main.reps ?? 1) - 1) * 2;
      return {
        kind,
        title: KIND_LABEL.tempo,
        warmup: warm(10),
        main: [main],
        cooldown: cool(10),
        totalMinutes: 20 + mainMin,
        intensity: EFFORT.tempo,
        notes,
      };
    }
    case "intervals": {
      const main: Step = beginner
        ? {
            label: "Faster running",
            reps: 6,
            minutes: 1,
            recovery: "2 min walk",
            effort: "Brisk, faster than your usual running (6 of 10)",
          }
        : level === "returning"
          ? {
              label: "Intervals",
              reps: 5,
              minutes: 3,
              recovery: "2 min easy jog",
              effort: EFFORT.interval,
              pace: range(paces?.interval),
            }
          : {
              label: "Intervals",
              reps: 6,
              meters: 800,
              recovery: "2 min easy jog",
              effort: EFFORT.interval,
              pace: range(paces?.interval),
            };
      const workMin = main.minutes ?? (paces ? ((main.meters ?? 0) / 1000) * (paces.interval[0] / 60) : 4);
      const mainMin = Math.round((main.reps ?? 1) * workMin + ((main.reps ?? 1) - 1) * 2);
      if (main.meters && paces)
        notes.push(
          `Each ${main.meters} m rep at about ${clock(Math.round((paces.interval[0] * main.meters) / 1000))}.`,
        );
      return {
        kind,
        title: KIND_LABEL.intervals,
        warmup: warm(beginner ? 8 : 12),
        main: [main],
        cooldown: cool(10),
        totalMinutes: (beginner ? 18 : 22) + mainMin,
        intensity: EFFORT.interval,
        notes,
      };
    }
    case "progression": {
      const total = Math.max(25, minutes);
      const body = total - 10;
      const third = Math.round(body / 3);
      return {
        kind,
        title: KIND_LABEL.progression,
        warmup: warm(5),
        main: [
          { label: "Easy", minutes: body - 2 * third, effort: EFFORT.easy, pace: range(paces?.easy) },
          { label: "Steady", minutes: third, effort: EFFORT.steady },
          {
            label: beginner ? "Brisk" : "Comfortably hard",
            minutes: third,
            effort: beginner ? EFFORT.steady : EFFORT.tempo,
            pace: beginner ? undefined : range(paces?.tempo),
          },
        ],
        cooldown: cool(5),
        totalMinutes: total,
        intensity: "Builds from easy to comfortably hard",
        notes,
      };
    }
    case "hills": {
      const reps = beginner ? 4 : level === "returning" ? 6 : 8;
      const secs = beginner ? 30 : level === "returning" ? 45 : 60;
      notes.push("Pick a moderate, safe slope with good footing and little traffic.");
      return {
        kind,
        title: KIND_LABEL.hills,
        warmup: warm(12),
        main: [
          {
            label: `${secs} s uphill`,
            reps,
            minutes: secs / 60,
            recovery: "Walk or jog back down",
            effort: EFFORT.hill,
          },
        ],
        cooldown: cool(10),
        totalMinutes: 22 + Math.round((reps * secs * 3) / 60),
        intensity: EFFORT.hill,
        notes,
      };
    }
  }
}

/** One-line description of a workout for lists and calendar entries. */
export function describeWorkout(w: WorkoutDetails) {
  const main = w.main
    .map((s) => {
      const work = s.meters ? `${s.meters} m` : s.minutes !== undefined ? `${Math.round(s.minutes * 10) / 10} min` : "";
      return `${s.reps ? `${s.reps} × ` : ""}${work} ${s.label.toLowerCase()}${s.recovery ? ` (${s.recovery})` : ""}`.trim();
    })
    .join(", then ");
  return `${w.warmup.minutes} min warm-up; ${main}; ${w.cooldown.minutes} min cool-down`;
}
