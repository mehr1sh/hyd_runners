import { z } from "zod";

export const CHALLENGE_KIND = {
  distance: { label: "Distance", unit: "km", help: "Total distance (at most 50 km a day counts)" },
  active_days: { label: "Active days", unit: "days", help: "Days with at least 10 minutes of activity" },
  activities: { label: "Activities", unit: "activities", help: "Activities of 10+ minutes (at most 2 a day count)" },
  early_runs: { label: "Early runs", unit: "days", help: "Days with a run starting between 5:00 and 7:30 am" },
  group_runs: { label: "Group runs", unit: "group runs", help: "Check-ins at weekly group runs" },
  events: { label: "Events", unit: "events", help: "Check-ins at any event" },
  places: { label: "Places", unit: "places", help: "Different places run or checked in at" },
  longest_run: { label: "Longest run", unit: "km", help: "A single activity of at least the goal" },
} as const;
export type ChallengeKind = keyof typeof CHALLENGE_KIND;
const KINDS = Object.keys(CHALLENGE_KIND) as [ChallengeKind, ...ChallengeKind[]];

const isMetres = (kind: ChallengeKind) => kind === "distance" || kind === "longest_run";

/** Value in the unit people think in (km for distances). */
export function displayValue(kind: ChallengeKind, value: number) {
  return isMetres(kind) ? Math.round(value / 100) / 10 : Math.round(value);
}

export function progressLabel(kind: ChallengeKind, value: number, goal: number) {
  const unit = CHALLENGE_KIND[kind].unit;
  return `${displayValue(kind, Math.min(value, goal))} of ${displayValue(kind, goal)} ${unit}`;
}

export function percent(value: number, goal: number) {
  return Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
}

export const ChallengeDraft = z
  .object({
    title: z.string().trim().min(3, "Name the challenge.").max(100),
    description: z.string().trim().max(1000),
    kind: z.enum(KINDS, "Choose what counts."),
    goal: z.number().positive("Set a goal above zero."),
    collective: z.boolean(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
    rewardXp: z.number().int().min(0).max(500),
    clubId: z.uuid().nullable(),
  })
  .refine((c) => c.endsOn >= c.startsOn, {
    message: "The end date must be on or after the start date.",
    path: ["endsOn"],
  })
  .refine((c) => !c.collective || !["early_runs", "places", "longest_run"].includes(c.kind), {
    message: "That kind of challenge can't be a group goal.",
    path: ["collective"],
  });

export function parseChallengeForm(formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const goalRaw = Number(formData.get("goal"));
  const club = String(formData.get("clubId") ?? "");
  const parsed = ChallengeDraft.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    kind,
    // Distances are entered in km and stored in metres.
    goal: (kind === "distance" || kind === "longest_run") && Number.isFinite(goalRaw) ? goalRaw * 1000 : goalRaw,
    collective: formData.get("collective") === "on",
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
    rewardXp: Number(formData.get("rewardXp") ?? 50),
    clubId: club === "" ? null : club,
  });
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the form." };
  return { ok: true as const, data: parsed.data };
}
