import type { WorkoutType } from "@/lib/contracts";

export const WORKOUT_TYPE_LABEL: Record<WorkoutType, string> = {
  run: "Run",
  walk_run: "Walk-run",
  walk: "Walk",
  strength: "Strength",
  conditioning: "Conditioning",
  mobility: "Mobility / yoga",
  cross_training: "Cross-training",
  rest: "Rest",
};

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatDistance(meters: number | null | undefined) {
  if (meters === null || meters === undefined) return "—";
  return `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} km`;
}

export function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** Format a local YYYY-MM-DD date without timezone shifts. */
export function formatLocalDate(
  d: string,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
) {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}
