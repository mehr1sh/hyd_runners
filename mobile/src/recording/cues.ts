/**
 * Audio cue scheduling: split announcements, workout step changes and pace
 * target nudges. Pure: returns what to say; the app speaks it with
 * expo-speech.
 *
 * To avoid excessive interruptions:
 * - Splits are announced every `splitEveryKm` km (1, 2 or 5), or never.
 * - Pace nudges ("ease off" / "pick it up") need the runner to be off target
 *   for `nudgeAfterS` and are at most one per `nudgeGapS`.
 * - Nothing (except a step change) is said within `minGapS` of the last cue;
 *   a skipped split is not repeated later.
 * - Muted means silent, but the schedule still advances, so unmuting does
 *   not trigger a burst of old announcements.
 */
import { formatDuration, formatPace } from "./geo";
import { advanceWorkout, paceVersusTarget, startWorkout, type PlannedWorkout, type WorkoutState } from "./workout";

export type CuePrefs = {
  muted: boolean;
  /** 0 disables split announcements. */
  splitEveryKm: 0 | 1 | 2 | 5;
  paceNudges: boolean;
};

export const DEFAULT_CUE_PREFS: CuePrefs = { muted: false, splitEveryKm: 1, paceNudges: true };

export type CueTiming = { minGapS: number; nudgeAfterS: number; nudgeGapS: number };
const TIMING: CueTiming = { minGapS: 8, nudgeAfterS: 30, nudgeGapS: 90 };

export type Cue = { kind: "split" | "step" | "pace" | "done"; text: string };

export type CueState = {
  /** Next split boundary in km. */
  nextSplitKm: number;
  lastSplitAtS: number;
  lastSplitAtM: number;
  lastCueAtS: number;
  offTargetSinceS: number | null;
  lastNudgeAtS: number;
  workout: WorkoutState | null;
};

export function initialCueState(prefs: CuePrefs, plan: PlannedWorkout | null): CueState {
  return {
    nextSplitKm: prefs.splitEveryKm || 1,
    lastSplitAtS: 0,
    lastSplitAtM: 0,
    lastCueAtS: -Infinity,
    offTargetSinceS: null,
    lastNudgeAtS: -Infinity,
    workout: plan ? startWorkout() : null,
  };
}

export type CueInput = {
  distanceM: number;
  /** Timer (moving) seconds. */
  movingS: number;
  currentPace: number | null;
};

const kmWords = (km: number) => (km === 1 ? "1 kilometre" : `${km} kilometres`);
const spokenPace = (p: number) => {
  const [m, s] = formatPace(p).split(":");
  return s === "00" ? `${m} minutes per kilometre` : `${m} ${s} per kilometre`;
};
const spokenDuration = (sec: number) => {
  const parts = formatDuration(sec).split(":").map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return (
    [h ? `${h} hours` : "", m ? `${m} minutes` : "", s ? `${s} seconds` : ""].filter(Boolean).join(" ") || "0 seconds"
  );
};

export function stepText(step: {
  label: string;
  distanceM?: number;
  durationS?: number;
  pace?: { min: number; max: number };
}) {
  const length =
    step.distanceM !== undefined
      ? `${step.distanceM >= 1000 ? `${step.distanceM / 1000} kilometres` : `${step.distanceM} metres`}`
      : step.durationS !== undefined
        ? spokenDuration(step.durationS)
        : "";
  const pace = step.pace ? `, target ${spokenPace(step.pace.min)} to ${spokenPace(step.pace.max)}` : "";
  return `${step.label}${length ? `, ${length}` : ""}${pace}.`;
}

/** Decide which cues to speak for the latest metrics. */
export function nextCues(
  prefs: CuePrefs,
  plan: PlannedWorkout | null,
  state: CueState,
  input: CueInput,
  timing: CueTiming = TIMING,
): { state: CueState; cues: Cue[] } {
  const s: CueState = { ...state };
  const cues: Cue[] = [];
  const now = input.movingS;
  const quiet = () => now - s.lastCueAtS < timing.minGapS;

  // Workout step changes take priority over everything else.
  let currentStep = null as PlannedWorkout["steps"][number] | null;
  if (plan && s.workout) {
    const { state: w, changes } = advanceWorkout(plan, s.workout, input.distanceM, input.movingS);
    s.workout = w;
    const last = changes[changes.length - 1];
    if (last) {
      cues.push(
        last.step
          ? { kind: "step", text: stepText(last.step) }
          : { kind: "done", text: "Workout complete. Nice work." },
      );
      s.offTargetSinceS = null;
    }
    currentStep = plan.steps[w.index] ?? null;
  }

  // Splits: every N km. Several boundaries crossed at once collapse into one.
  if (prefs.splitEveryKm > 0 && input.distanceM >= s.nextSplitKm * 1000) {
    const reachedKm = Math.floor(input.distanceM / 1000 / prefs.splitEveryKm) * prefs.splitEveryKm;
    const splitS = now - s.lastSplitAtS;
    const splitM = reachedKm * 1000 - s.lastSplitAtM;
    s.nextSplitKm = reachedKm + prefs.splitEveryKm;
    s.lastSplitAtS = now;
    s.lastSplitAtM = reachedKm * 1000;
    if (cues.length === 0 && !quiet()) {
      const pace = splitM > 0 ? (splitS / splitM) * 1000 : null;
      cues.push({
        kind: "split",
        text: `${kmWords(reachedKm)}. Time ${spokenDuration(now)}.${pace ? ` Last split ${spokenPace(pace)}.` : ""}`,
      });
    }
  }

  // Pace nudges against the current step's target.
  if (prefs.paceNudges && currentStep?.pace) {
    const verdict = paceVersusTarget(input.currentPace, currentStep.pace);
    if (verdict === "fast" || verdict === "slow") {
      s.offTargetSinceS ??= now;
      if (
        now - s.offTargetSinceS >= timing.nudgeAfterS &&
        now - s.lastNudgeAtS >= timing.nudgeGapS &&
        cues.length === 0 &&
        !quiet()
      ) {
        cues.push({ kind: "pace", text: verdict === "fast" ? "Ease off a little." : "Pick it up a little." });
        s.lastNudgeAtS = now;
        s.offTargetSinceS = null;
      }
    } else {
      s.offTargetSinceS = null;
    }
  }

  if (cues.length > 0) s.lastCueAtS = now;
  return { state: s, cues: prefs.muted ? [] : cues };
}
