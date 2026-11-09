import type { PrKey } from "@/features/activities/logic/normalize";

/**
 * Race-time estimates from the runner's own GPS best efforts (Riegel's
 * formula, T2 = T1 × (D2 / D1)^1.06).
 *
 * Deliberately conservative:
 * - Only efforts of 5 km or longer from the last 180 days are used; 1 km and
 *   1 mile segments overstate endurance.
 * - The source effort is the one closest in distance to the target, and the
 *   target may be at most 4.5× its distance (so a marathon needs a 10 km or
 *   longer effort).
 * - The range widens with the distance ratio and the age of the effort.
 * An estimate is never a guaranteed finish time; callers must show the
 * limitations alongside it.
 */

export const RACE_DISTANCES = [
  { key: "5k", meters: 5000, label: "5K" },
  { key: "10k", meters: 10000, label: "10K" },
  { key: "half", meters: 21097.5, label: "Half marathon" },
  { key: "marathon", meters: 42195, label: "Marathon" },
] as const;
export type RaceKey = (typeof RACE_DISTANCES)[number]["key"];

export const EFFORT_METERS: Partial<Record<PrKey, number>> = {
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
  marathon: 42195,
};

export type Effort = { key: PrKey; seconds: number; activityId: string; startedAt: string };

export type Prediction =
  | {
      race: RaceKey;
      label: string;
      ok: true;
      seconds: number;
      low: number;
      high: number;
      basis: { key: PrKey; seconds: number; activityId: string; startedAt: string; ageDays: number };
      limitations: string[];
    }
  | { race: RaceKey; label: string; ok: false; reason: string };

const MAX_AGE_DAYS = 180;
const MAX_RATIO = 4.5;
const RIEGEL = 1.06;

export function riegel(seconds: number, fromMeters: number, toMeters: number) {
  return seconds * Math.pow(toMeters / fromMeters, RIEGEL);
}

export function predictRaces(efforts: Effort[], nowMs: number): Prediction[] {
  const usable = efforts
    .filter((e) => EFFORT_METERS[e.key] !== undefined && e.seconds > 0)
    .map((e) => ({
      ...e,
      meters: EFFORT_METERS[e.key]!,
      ageDays: Math.floor((nowMs - Date.parse(e.startedAt)) / 86_400_000),
    }))
    .filter((e) => e.ageDays >= 0 && e.ageDays <= MAX_AGE_DAYS);

  return RACE_DISTANCES.map((race): Prediction => {
    if (usable.length === 0) {
      return {
        race: race.key,
        label: race.label,
        ok: false,
        reason: "No GPS effort of 5 km or longer in the last 180 days.",
      };
    }
    const source = usable.reduce((best, e) =>
      Math.abs(Math.log(race.meters / e.meters)) < Math.abs(Math.log(race.meters / best.meters)) ? e : best,
    );
    const ratio = race.meters / source.meters;
    if (ratio > MAX_RATIO) {
      return {
        race: race.key,
        label: race.label,
        ok: false,
        reason: `Your longest recent effort (${source.meters / 1000} km) is too short to estimate a ${race.label} reliably.`,
      };
    }
    const seconds = Math.round(riegel(source.seconds, source.meters, race.meters));
    const spread = 0.02 + 0.03 * Math.abs(Math.log(ratio)) + 0.01 * Math.floor(source.ageDays / 60);
    const limitations = [
      "Based on your fastest GPS segment, not an official race result; GPS distance can be off by a few percent.",
    ];
    if (ratio > 1.5)
      limitations.push(
        `Extrapolated from a shorter distance (${(source.meters / 1000).toFixed(source.meters % 1000 ? 1 : 0)} km); assumes endurance training for the longer race.`,
      );
    if (race.key === "marathon")
      limitations.push(
        "Marathon estimates assume marathon-specific long runs; heat and fuelling change results a lot.",
      );
    if (source.ageDays > 90) limitations.push(`The effort is ${source.ageDays} days old.`);
    return {
      race: race.key,
      label: race.label,
      ok: true,
      seconds,
      low: Math.round(seconds * (1 - spread)),
      high: Math.round(seconds * (1 + spread)),
      basis: {
        key: source.key,
        seconds: source.seconds,
        activityId: source.activityId,
        startedAt: source.startedAt,
        ageDays: source.ageDays,
      },
      limitations,
    };
  });
}
