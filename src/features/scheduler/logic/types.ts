import { z } from "zod";
import {
  AvailabilityKind,
  AvailabilitySource,
  FitnessGoal,
  FitnessLevel,
  IsoDate,
  LocalTime,
  TimeOfDay,
  Weekday,
  WorkoutType,
} from "@/lib/contracts";

/**
 * Feature-private view models for the planner. Shared entities
 * (`AvailabilityBlock`, `PlannedWorkout`, `SchedulerInput`, `SchedulerResult`,
 * `ExtractedTimetable`) come from `@/lib/contracts` and are not redefined here.
 */

/**
 * An availability row while the runner is still reviewing it. Unlike the
 * `AvailabilityBlock` contract, fields may be missing: an extractor leaves a
 * field null instead of guessing, and the row cannot be confirmed until the
 * runner fills it in.
 */
export const AvailabilityDraft = z.object({
  /** Stable key for the UI list; not persisted. */
  key: z.string().min(1).max(64),
  weekday: Weekday.nullable(),
  startTime: LocalTime.nullable(),
  endTime: LocalTime.nullable(),
  kind: AvailabilityKind,
  label: z.string().max(80).nullable(),
  source: AvailabilitySource,
  /** 0–1 for extracted rows, null for rows the runner typed. */
  confidence: z.number().min(0).max(1).nullable(),
  /** What the extractor could not determine, in plain words. Empty when certain. */
  uncertainties: z.array(z.string().max(200)).max(10).default([]),
  /** The source text the row came from, shown during review. Never persisted. */
  rawText: z.string().max(200).nullable().default(null),
  /** True once the runner has looked at (or typed) this row. */
  confirmed: z.boolean().default(false),
});
export type AvailabilityDraft = z.infer<typeof AvailabilityDraft>;

export type AvailabilityIssue = {
  /** Index into the submitted drafts, or null for whole-set problems. */
  index: number | null;
  field: "weekday" | "startTime" | "endTime" | "kind" | "confirmed" | null;
  code:
    | "missing_weekday"
    | "missing_start"
    | "missing_end"
    | "end_before_start"
    | "too_short"
    | "overlap_same_kind"
    | "free_overlaps_busy"
    | "unconfirmed"
    | "no_free_time";
  severity: "error" | "warning";
  message: string;
};

/** What the runner tells the planner. Persisted with an approved plan as a snapshot. */
export const PlannerSettings = z.object({
  goal: FitnessGoal,
  fitnessLevel: FitnessLevel,
  sessionsPerWeek: z.number().int().min(1).max(7),
  maxSessionMinutes: z.number().int().min(10).max(180),
  preferredDays: z.array(Weekday).max(7),
  preferredTimesOfDay: z.array(TimeOfDay).max(5),
  /** Week number inside the plan's progression (1 = first week). */
  programmeWeek: z.number().int().min(1).max(52),
});
export type PlannerSettings = z.infer<typeof PlannerSettings>;

/** One session in a proposal, in local wall-clock time. Converted to `PlannedWorkout` on approval. */
export const ProposedSession = z.object({
  key: z.string().min(1).max(64),
  weekday: Weekday,
  startTime: LocalTime,
  durationMinutes: z.number().int().min(5).max(300),
  workoutType: WorkoutType.exclude(["rest"]),
  title: z.string().min(1).max(120),
  rationale: z.array(z.string().max(300)).max(8),
  plannedBy: z.enum(["scheduler", "runner"]),
});
export type ProposedSession = z.infer<typeof ProposedSession>;

export type UnsatisfiedPreference = {
  preference: "sessionsPerWeek" | "preferredDays" | "preferredTimesOfDay" | "maxSessionMinutes" | "session";
  message: string;
  /** Concrete things the runner can change. */
  alternatives: string[];
};

export type ScheduleViolation = {
  code:
    | "outside_availability"
    | "overlaps_busy"
    | "overlaps_session"
    | "overlaps_existing"
    | "duration_out_of_range"
    | "too_many_sessions"
    | "too_many_per_day"
    | "consecutive_hard_days"
    | "not_enough_rest_days"
    | "invalid_session"
    | "outside_week";
  /** Keys of the sessions involved; empty for week-level problems. */
  sessionKeys: string[];
  message: string;
};

export type ProposalSource = "deterministic" | "ai_assisted";

export type WeeklyProposal = {
  weekStart: IsoDate;
  timezone: string;
  settings: PlannerSettings;
  sessions: ProposedSession[];
  /** Weekdays with no session, kept as recovery. */
  restDays: number[];
  unsatisfied: UnsatisfiedPreference[];
  /** Non-blocking notes, e.g. a requested frequency was capped for recovery. */
  warnings: string[];
  source: ProposalSource;
};

export const ProposalPayload = z.object({
  weekStart: IsoDate,
  settings: PlannerSettings,
  sessions: z.array(ProposedSession).max(14),
});
export type ProposalPayload = z.infer<typeof ProposalPayload>;
