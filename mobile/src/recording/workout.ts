/**
 * Planned workouts (interval sets with pace targets) and their progress.
 * Steps end after a distance or a timer duration. Pure.
 */
export type PaceTarget = { /** fastest, s/km */ min: number; /** slowest, s/km */ max: number };

export type WorkoutStep = {
  kind: "warmup" | "work" | "recover" | "cooldown";
  label: string;
  /** Exactly one of distanceM / durationS ends the step. */
  distanceM?: number;
  durationS?: number;
  pace?: PaceTarget;
};

export type PlannedWorkout = { id: string; name: string; steps: WorkoutStep[] };

/** Built-in plans. A step without an end (the last cooldown) runs until Finish. */
export const PRESET_WORKOUTS: PlannedWorkout[] = [
  {
    id: "intervals-6x400",
    name: "6 × 400 m intervals",
    steps: [
      { kind: "warmup", label: "Warm-up", durationS: 600 },
      ...Array.from({ length: 6 }, (_, i): WorkoutStep[] => [
        { kind: "work", label: `Interval ${i + 1} of 6`, distanceM: 400, pace: { min: 240, max: 270 } },
        { kind: "recover", label: "Recovery jog", durationS: 90 },
      ]).flat(),
      { kind: "cooldown", label: "Cool-down", durationS: 600 },
    ],
  },
  {
    id: "tempo-3x8",
    name: "Tempo 3 × 8 min",
    steps: [
      { kind: "warmup", label: "Warm-up", durationS: 600 },
      ...Array.from({ length: 3 }, (_, i): WorkoutStep[] => [
        { kind: "work", label: `Tempo ${i + 1} of 3`, durationS: 480, pace: { min: 285, max: 315 } },
        { kind: "recover", label: "Easy jog", durationS: 120 },
      ]).flat(),
      { kind: "cooldown", label: "Cool-down", durationS: 600 },
    ],
  },
  {
    id: "easy-5k",
    name: "Easy 5 km at conversation pace",
    steps: [{ kind: "work", label: "Easy 5 km", distanceM: 5000, pace: { min: 360, max: 450 } }],
  },
];

/** Where the runner is in a plan. Step starts are remembered as they happen. */
export type WorkoutState = {
  /** Index of the current step; equal to steps.length once all steps are done. */
  index: number;
  stepStartM: number;
  stepStartS: number;
};

export const startWorkout = (): WorkoutState => ({ index: 0, stepStartM: 0, stepStartS: 0 });

export type StepChange = { from: number; to: number; step: WorkoutStep | null };

/**
 * Advance the plan with the latest cumulative distance and timer seconds.
 * Several steps can end in one update (e.g. after a GPS gap); each change is
 * returned so the cue engine can announce the step the runner is now in.
 */
export function advanceWorkout(
  plan: PlannedWorkout,
  state: WorkoutState,
  distanceM: number,
  movingS: number,
): { state: WorkoutState; changes: StepChange[] } {
  const changes: StepChange[] = [];
  let s = state;
  while (s.index < plan.steps.length) {
    const step = plan.steps[s.index];
    const ended =
      (step.distanceM !== undefined && distanceM - s.stepStartM >= step.distanceM) ||
      (step.durationS !== undefined && movingS - s.stepStartS >= step.durationS);
    if (!ended) break;
    // The next step starts where this one should have ended, not at "now",
    // so a late update does not shorten the following step.
    const next: WorkoutState = {
      index: s.index + 1,
      stepStartM: step.distanceM !== undefined ? s.stepStartM + step.distanceM : distanceM,
      stepStartS: step.durationS !== undefined ? s.stepStartS + step.durationS : movingS,
    };
    changes.push({ from: s.index, to: next.index, step: plan.steps[next.index] ?? null });
    s = next;
  }
  return { state: s, changes };
}

/** Remaining metres or seconds in the current step (null for an open-ended step or when done). */
export function stepRemaining(
  plan: PlannedWorkout,
  state: WorkoutState,
  distanceM: number,
  movingS: number,
): { meters?: number; seconds?: number } | null {
  const step = plan.steps[state.index];
  if (!step) return null;
  if (step.distanceM !== undefined) return { meters: Math.max(0, state.stepStartM + step.distanceM - distanceM) };
  if (step.durationS !== undefined) return { seconds: Math.max(0, state.stepStartS + step.durationS - movingS) };
  return null;
}

/** Whether a pace is inside, faster than or slower than the target. */
export function paceVersusTarget(pace: number | null, target: PaceTarget | undefined): "on" | "fast" | "slow" | null {
  if (pace === null || !target) return null;
  if (pace < target.min) return "fast";
  if (pace > target.max) return "slow";
  return "on";
}
