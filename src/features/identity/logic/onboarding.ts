import { z } from "zod";
import {
  DEFAULT_TIMEZONE,
  FitnessGoal,
  FitnessLevel,
  TimeOfDay,
  UserPreferences,
  Weekday,
  type FitnessGoal as FitnessGoalType,
  type FitnessLevel as FitnessLevelType,
  type PrimaryNeed as PrimaryNeedType,
  type TimeOfDay as TimeOfDayType,
} from "@/lib/contracts";

export const PreferredActivity = z.enum([
  "run",
  "walk_run",
  "walk",
  "strength",
  "conditioning",
  "mobility",
  "cross_training",
]);
export type PreferredActivity = z.infer<typeof PreferredActivity>;

export const ACTIVITY_LABEL: Record<PreferredActivity, string> = {
  run: "Running",
  walk_run: "Walk-run",
  walk: "Walking",
  strength: "Strength",
  conditioning: "Conditioning",
  mobility: "Mobility",
  cross_training: "Cross training",
};

export const FITNESS_LEVEL_LABEL: Record<FitnessLevelType, string> = {
  new_to_running: "New to running",
  returning: "Returning after a break",
  regular: "Already running a little",
};

export const GOAL_LABEL: Record<FitnessGoalType, string> = {
  build_habit: "Build a habit",
  first_5k: "Finish a first 5K",
  run_without_stopping: "Run without stopping",
  get_stronger: "Get stronger",
  return_after_break: "Return after a break",
};

export const TIME_OF_DAY_LABEL: Record<TimeOfDayType, string> = {
  early_morning: "Early morning",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export const WEEKDAY_LABEL: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export const NEED_LABEL: Record<PrimaryNeedType, string> = {
  consistency: "Staying consistent",
  schedule_conflicts: "A changing timetable",
  both: "Consistency and a changing timetable",
};

export function primaryNeedFromDifficulties(consistency: boolean, schedule: boolean): PrimaryNeedType | null {
  if (consistency && schedule) return "both";
  if (consistency) return "consistency";
  if (schedule) return "schedule_conflicts";
  return null;
}

export function difficultiesFromPrimaryNeed(need: PrimaryNeedType | null) {
  return {
    consistency: need === "consistency" || need === "both",
    schedule: need === "schedule_conflicts" || need === "both",
  };
}

/** True for IANA names the runtime knows (e.g. "Asia/Kolkata"). The scheduler formats with this value. */
export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const TimeZoneField = z.string().trim().min(1).refine(isValidTimeZone, "Enter a timezone such as Asia/Kolkata.");

const ExperienceFields = z
  .object({
    displayName: z.string().trim().min(1, "Tell us what to call you.").max(60, "Use 60 characters or fewer."),
    fitnessLevel: FitnessLevel,
    consistency: z.boolean(),
    scheduleConflicts: z.boolean(),
    timezone: TimeZoneField.default(DEFAULT_TIMEZONE),
  })
  .refine((value) => value.consistency || value.scheduleConflicts, {
    message: "Select consistency, scheduling, or both.",
    path: ["consistency"],
  });

export const TrainingFields = z.object({
  goal: FitnessGoal,
  preferredActivities: z.array(PreferredActivity).min(1, "Choose at least one activity."),
  preferredDays: z.array(Weekday).min(1, "Choose at least one day.").max(7),
  preferredTimesOfDay: z.array(TimeOfDay).min(1, "Choose at least one time of day.").max(5),
  sessionsPerWeek: z.number().int().min(1).max(7),
  maxSessionMinutes: z.number().int().min(10, "Sessions need at least 10 minutes.").max(180),
});

export const PlacesFields = z.object({
  preferredLocationIds: z.array(z.uuid()).max(8),
  remindersEnabled: z.boolean(),
  notifyInApp: z.boolean(),
});

export const OnboardingPreferences = UserPreferences.extend({
  preferredActivities: z.array(PreferredActivity),
  preferredLocationIds: z.array(z.uuid()),
  notifyInApp: z.boolean(),
});
export type OnboardingPreferences = z.infer<typeof OnboardingPreferences>;

export type ExperienceInput = z.infer<typeof ExperienceFields> & { primaryNeed: PrimaryNeedType };
export type TrainingInput = z.infer<typeof TrainingFields>;
export type PlacesInput = z.infer<typeof PlacesFields>;

export type FieldErrors = Record<string, string>;

function failure(error: z.ZodError) {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false as const,
    message: error.issues[0]?.message ?? "Some fields are missing or invalid.",
    fieldErrors,
  };
}

function checked(formData: FormData, name: string) {
  return formData.get(name) === "yes" || formData.get(name) === "on";
}

function numbers(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

export function parseExperienceForm(formData: FormData) {
  const parsed = ExperienceFields.safeParse({
    displayName: formData.get("displayName"),
    fitnessLevel: formData.get("fitnessLevel"),
    consistency: checked(formData, "consistency"),
    scheduleConflicts: checked(formData, "scheduleConflicts"),
    timezone: formData.get("timezone") || DEFAULT_TIMEZONE,
  });
  if (!parsed.success) return failure(parsed.error);
  const primaryNeed = primaryNeedFromDifficulties(parsed.data.consistency, parsed.data.scheduleConflicts);
  if (!primaryNeed) {
    return {
      ok: false as const,
      message: "Select consistency, scheduling, or both.",
      fieldErrors: { consistency: "Select at least one." },
    };
  }
  return { ok: true as const, data: { ...parsed.data, primaryNeed } };
}

export function parseTrainingForm(formData: FormData) {
  const sessions = Number(formData.get("sessionsPerWeek"));
  const minutes = Number(formData.get("maxSessionMinutes"));
  const parsed = TrainingFields.safeParse({
    goal: formData.get("goal"),
    preferredActivities: formData.getAll("preferredActivities"),
    preferredDays: numbers(formData, "preferredDays"),
    preferredTimesOfDay: formData.getAll("preferredTimesOfDay"),
    sessionsPerWeek: sessions,
    maxSessionMinutes: minutes,
  });
  if (!parsed.success) return failure(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export function parsePlacesForm(formData: FormData) {
  const parsed = PlacesFields.safeParse({
    preferredLocationIds: formData.getAll("preferredLocationIds").filter((value) => value !== ""),
    remindersEnabled: checked(formData, "remindersEnabled"),
    notifyInApp: checked(formData, "notifyInApp"),
  });
  if (!parsed.success) return failure(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export function resumeStep(input: {
  fitnessLevel: string | null;
  hasPreferences: boolean;
  onboarded: boolean;
}): 1 | 2 | 3 | 4 {
  if (input.onboarded) return 4;
  if (!input.fitnessLevel) return 1;
  if (!input.hasPreferences) return 2;
  return 3;
}
