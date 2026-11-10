import { daysBetween, type LocalDate } from "@/features/gamification/logic/time";

export const RACE_DISTANCE_M = { "5k": 5000, "10k": 10000, half: 21097, marathon: 42195 } as const;
export const RACE_DISTANCE_LABEL = {
  "5k": "5K",
  "10k": "10K",
  half: "Half marathon",
  marathon: "Marathon",
  other: "Other",
} as const;
export type RaceDistance = keyof typeof RACE_DISTANCE_LABEL;

export type ChecklistItem = { id: string; label: string; done: boolean };

/** Starting checklist; runners can tick, remove and add items. */
export function defaultChecklist(distance: RaceDistance): ChecklistItem[] {
  const items = [
    "Collect bib and timing chip",
    "Plan how to get to the start (and back)",
    "Pin bib, lay out kit the night before",
    "Charge watch and phone",
    "Breakfast you've tried before a long run",
    "Water bottle or know the drink stations",
    "Arrive 45 minutes before the start",
  ];
  if (distance === "half" || distance === "marathon")
    items.push("Gels or fuel you've trained with", "Anti-chafe and sun cream");
  return items.map((label, i) => ({ id: `d${i}`, label, done: false }));
}

export function countdown(today: LocalDate, raceDate: LocalDate) {
  const d = daysBetween(today, raceDate);
  if (d > 1) return `${d} days to go`;
  if (d === 1) return "Tomorrow";
  if (d === 0) return "Race day";
  return `${-d} day${d === -1 ? "" : "s"} ago`;
}

export type ResultSource = "organizer_verified" | "imported_activity" | "self_reported";
export const RESULT_SOURCE_LABEL: Record<ResultSource, string> = {
  organizer_verified: "Verified by the organiser",
  imported_activity: "From your recorded activity",
  self_reported: "Entered by you",
};

/** The result to show: organiser-verified results win over the runner's own. */
export function bestResult(
  organiser: { finishSeconds: number | null; outcome: string } | null,
  own: { seconds: number | null; source: ResultSource | null },
): { seconds: number | null; source: ResultSource; outcome?: string } | null {
  if (organiser) return { seconds: organiser.finishSeconds, source: "organizer_verified", outcome: organiser.outcome };
  if (own.seconds && own.source) return { seconds: own.seconds, source: own.source };
  return null;
}
