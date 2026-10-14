import type { WorkoutType, XpReason } from "@/lib/contracts";
import type { LocalDate } from "./time";

/** A completed workout as the reward engine sees it (feature-internal view of CompletedWorkout). */
export type WorkoutFact = {
  id: string;
  workoutType: WorkoutType;
  startedAt: string; // ISO instant
  completedAt: string; // ISO instant
  durationSeconds: number;
  distanceMeters: number | null;
  programmeSessionId: string | null;
  enrollmentId: string | null;
  plannedWorkoutId: string | null;
  /** Local date the scheduler planned it for, when known. */
  plannedDate: LocalDate | null;
};

/** One enrolment and every session of its programme (for milestones). */
export type EnrollmentFact = {
  enrollmentId: string;
  programmeSlug: string;
  sessions: { id: string; week: number }[];
};

export type RewardHistory = {
  timezone: string;
  workouts: WorkoutFact[];
  enrollments: EnrollmentFact[];
  firstRsvpAt: string | null;
  /**
   * Award keys already in the ledger. Used so a backdated workout that moves
   * a streak's start date cannot pay the same streak milestone twice.
   */
  existingAwardKeys?: Iterable<string>;
};

export type Award = {
  awardKey: string;
  reason: XpReason;
  deltaXp: number;
  deltaCoins: number;
  refTable: string | null;
  refId: string | null;
  occurredAt: string;
  /** Human-readable explanation shown to the runner. */
  label: string;
};

export type BadgeEarned = { code: string; earnedAt: string };
export type ChallengeDone = { code: string; weekStart: LocalDate; completedAt: string };
export type EnrollmentDone = { enrollmentId: string; completedAt: string };

export type RewardOutcome = {
  awards: Award[];
  badges: BadgeEarned[];
  challenges: ChallengeDone[];
  completedEnrollments: EnrollmentDone[];
  /** Days whose workout XP was withheld by the recovery guard. */
  recoveryCappedDays: LocalDate[];
};
