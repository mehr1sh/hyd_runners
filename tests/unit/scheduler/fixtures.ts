import type { AvailabilityDraft, PlannerSettings } from "@/features/scheduler/logic";

let n = 0;
export const makeKey = () => `k${++n}`;

export function draft(
  weekday: number | null,
  startTime: string | null,
  endTime: string | null,
  kind: "free" | "busy" = "free",
  extra: Partial<AvailabilityDraft> = {},
): AvailabilityDraft {
  return {
    key: makeKey(),
    weekday,
    startTime,
    endTime,
    kind,
    label: null,
    source: "manual",
    confidence: null,
    uncertainties: [],
    rawText: null,
    confirmed: true,
    ...extra,
  };
}

export function block(weekday: number, startTime: string, endTime: string, kind: "free" | "busy" = "free") {
  return { weekday, startTime, endTime, kind } as const;
}

export const settings = (overrides: Partial<PlannerSettings> = {}): PlannerSettings => ({
  goal: "first_5k",
  fitnessLevel: "new_to_running",
  sessionsPerWeek: 3,
  maxSessionMinutes: 45,
  preferredDays: [],
  preferredTimesOfDay: [],
  programmeWeek: 1,
  ...overrides,
});

/** A student week: classes 09:00–17:00 on weekdays, free early mornings and evenings. */
export const normalWeek = [
  ...[1, 2, 3, 4, 5].flatMap((d) => [
    block(d, "06:00", "08:00"),
    block(d, "09:00", "17:00", "busy"),
    block(d, "18:00", "20:00"),
  ]),
  block(6, "07:00", "11:00"),
  block(7, "07:00", "10:00"),
];
