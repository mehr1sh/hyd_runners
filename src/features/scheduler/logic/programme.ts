import type { FitnessLevel, WorkoutType } from "@/lib/contracts";
import type { PlannerSettings } from "./types";

/**
 * Recovery rules and the weekly session plan. These are conservative product
 * defaults for beginners, not medical advice, and they are the only place
 * the numbers live so they can be reviewed in one spot.
 *
 * "Hard" sessions load the legs or heart (running, run/walk, strength,
 * conditioning). Easy sessions (walking, mobility, cross-training) may sit
 * next to a hard day.
 */

export type RecoveryRules = {
  /** Most sessions in one week, including easy ones. */
  maxSessionsPerWeek: number;
  /** Most hard sessions in one week. */
  maxHardPerWeek: number;
  /** Days with no session at all. */
  minRestDays: number;
  /** Longest run of hard sessions on consecutive days (1 = never back to back). */
  maxConsecutiveHardDays: number;
  /** Sessions on the same day. Kept at one for every level in the first release. */
  maxSessionsPerDay: number;
};

export const RECOVERY_RULES: Record<FitnessLevel, RecoveryRules> = {
  new_to_running: {
    maxSessionsPerWeek: 4,
    maxHardPerWeek: 3,
    minRestDays: 3,
    maxConsecutiveHardDays: 1,
    maxSessionsPerDay: 1,
  },
  returning: {
    maxSessionsPerWeek: 5,
    maxHardPerWeek: 3,
    minRestDays: 2,
    maxConsecutiveHardDays: 1,
    maxSessionsPerDay: 1,
  },
  regular: {
    maxSessionsPerWeek: 6,
    maxHardPerWeek: 4,
    minRestDays: 1,
    maxConsecutiveHardDays: 2,
    maxSessionsPerDay: 1,
  },
};

const HARD_TYPES: readonly WorkoutType[] = ["run", "walk_run", "strength", "conditioning"];

export function isHard(type: WorkoutType) {
  return HARD_TYPES.includes(type);
}

export const MIN_SESSION_MINUTES = 10;

export type SessionTemplate = {
  key: string;
  title: string;
  workoutType: Exclude<WorkoutType, "rest">;
  /** Planned length after applying the runner's limit. */
  durationMinutes: number;
  /** Ideal length before the limit; used to explain shortening. */
  idealMinutes: number;
  /** Shortest version that is still worth doing (warm-up and cool-down included). */
  minMinutes: number;
  /** Lower numbers are placed first and dropped last. */
  priority: number;
  /** Why this session is in the week, for the rationale. */
  purpose: string;
};

type Base = Omit<SessionTemplate, "key" | "durationMinutes" | "priority">;

/**
 * Run/walk progression for runners who are new to running. Each step is a
 * repeat of (run, walk) with a five-minute warm-up and cool-down. Week 7
 * onwards is continuous easy running.
 */
const NEW_RUNNER_INTERVALS: Array<{ run: string; walk: string; repeats: number }> = [
  { run: "60s", walk: "90s", repeats: 8 },
  { run: "90s", walk: "2 min", repeats: 6 },
  { run: "3 min", walk: "3 min", repeats: 4 },
  { run: "5 min", walk: "2½ min", repeats: 3 },
  { run: "8 min", walk: "5 min", repeats: 2 },
  { run: "10 min", walk: "3 min", repeats: 2 },
];

function keySession(settings: PlannerSettings): Base {
  const week = settings.programmeWeek;
  if (settings.goal === "get_stronger") {
    return {
      title: "Bodyweight strength",
      workoutType: "strength",
      idealMinutes: settings.fitnessLevel === "regular" ? 40 : 30,
      minMinutes: 20,
      purpose: "builds strength for your goal",
    };
  }
  switch (settings.fitnessLevel) {
    case "new_to_running": {
      const step = NEW_RUNNER_INTERVALS[week - 1];
      if (step) {
        return {
          title: `Run/walk: ${step.run} run, ${step.walk} walk ×${step.repeats}`,
          workoutType: "walk_run",
          idealMinutes: settings.goal === "build_habit" ? 25 : 30,
          minMinutes: 20,
          purpose: `is week ${week} of a gradual run/walk progression`,
        };
      }
      return {
        title: "Easy continuous run",
        workoutType: "run",
        idealMinutes: 30,
        minMinutes: 20,
        purpose: "continues the progression with easy continuous running",
      };
    }
    case "returning":
      return week <= 2
        ? {
            title: "Run/walk: 3 min run, 1 min walk ×6",
            workoutType: "walk_run",
            idealMinutes: 30,
            minMinutes: 20,
            purpose: "eases you back in with short run intervals",
          }
        : {
            title: "Easy run",
            workoutType: "run",
            idealMinutes: Math.min(30 + 5 * Math.floor((week - 3) / 2), 40),
            minMinutes: 20,
            purpose: "builds easy running time gradually",
          };
    case "regular":
      return {
        title: "Easy run",
        workoutType: "run",
        idealMinutes: Math.min(30 + 5 * Math.floor((week - 1) / 2), 45),
        minMinutes: 20,
        purpose: "keeps your easy running consistent",
      };
  }
}

const EASY_SESSIONS: Base[] = [
  {
    title: "Brisk walk",
    workoutType: "walk",
    idealMinutes: 30,
    minMinutes: 15,
    purpose: "adds easy movement on a lighter day",
  },
  {
    title: "Mobility and stretching",
    workoutType: "mobility",
    idealMinutes: 20,
    minMinutes: 10,
    purpose: "supports recovery between harder sessions",
  },
];

/**
 * The sessions to place this week, highest priority first. The requested
 * frequency is capped by the recovery rules for the runner's level; the cap
 * is reported, never silently applied.
 */
export function buildSessionPlan(settings: PlannerSettings): { templates: SessionTemplate[]; warnings: string[] } {
  const rules = RECOVERY_RULES[settings.fitnessLevel];
  const warnings: string[] = [];
  const total = Math.min(settings.sessionsPerWeek, rules.maxSessionsPerWeek);
  if (settings.sessionsPerWeek > rules.maxSessionsPerWeek) {
    warnings.push(
      `You asked for ${settings.sessionsPerWeek} sessions. For your level the plan keeps at most ${rules.maxSessionsPerWeek} sessions and ${rules.minRestDays} rest day${rules.minRestDays === 1 ? "" : "s"} a week, so recovery time is protected.`,
    );
  }
  const hard = Math.min(total, rules.maxHardPerWeek);
  const key = keySession(settings);
  const templates: SessionTemplate[] = [];
  const fit = (base: Base, index: number, priority: number): SessionTemplate => ({
    ...base,
    key: `s${index + 1}`,
    durationMinutes: Math.min(base.idealMinutes, settings.maxSessionMinutes),
    priority,
  });

  for (let i = 0; i < hard; i++) {
    // A strength goal still keeps one short run/walk for heart health when there is room.
    const base =
      settings.goal === "get_stronger" && i === 2
        ? { ...keySession({ ...settings, goal: "build_habit" }), purpose: "adds one cardio session to the week" }
        : key;
    templates.push(fit(base, templates.length, i));
  }
  for (let i = 0; templates.length < total; i++) {
    templates.push(fit(EASY_SESSIONS[i % EASY_SESSIONS.length], templates.length, 10 + i));
  }
  return { templates, warnings };
}
