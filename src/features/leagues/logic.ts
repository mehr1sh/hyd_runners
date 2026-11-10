export const LEAGUE_KINDS = {
  club: "Club vs club",
  university: "University league",
  corporate: "Corporate league",
  city: "City-wide",
  seasonal: "Seasonal",
  beginner: "Beginner league",
  consistency: "Consistency competition",
} as const;
export type LeagueKind = keyof typeof LEAGUE_KINDS;

export const SCORING_LABEL = {
  active_day: "per active day (any run or walk that day)",
  consistent_week: "per week with 3 or more active days",
  group_run: "per checked-in group run or event",
  per_5km: "per 5 km (capped at 50 km a day)",
  challenge: "per completed challenge",
  event: "per finished event or race",
} as const;
export type ScoringKey = keyof typeof SCORING_LABEL;

export const DEFAULT_SCORING: Record<ScoringKey, number> = {
  active_day: 10,
  consistent_week: 25,
  group_run: 15,
  per_5km: 5,
  challenge: 20,
  event: 30,
};

/** Suggested weights per league kind (organisers can change them before the start). */
export function scoringFor(kind: LeagueKind): Record<ScoringKey, number> {
  if (kind === "consistency" || kind === "beginner") return { ...DEFAULT_SCORING, per_5km: 0, consistent_week: 40 };
  if (kind === "club") return { ...DEFAULT_SCORING, group_run: 25 };
  return DEFAULT_SCORING;
}

export function joinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
