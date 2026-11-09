import { z } from "zod";

/** How fresh a shared position is. Stale positions are never shown as current. */
export type Freshness = "live" | "stale" | "lost";

export function freshness(recordedAt: string, nowMs: number): Freshness {
  const age = nowMs - Date.parse(recordedAt);
  if (age <= 90_000) return "live";
  if (age <= 10 * 60_000) return "stale";
  return "lost";
}

export function ageLabel(recordedAt: string, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(recordedAt)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export const PositionBody = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000).nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});

/** Fixes worse than this are not sent; they'd mislead the captain. */
export const MAX_ACCURACY_M = 100;
/** Minimum gap between position uploads from the browser. */
export const SEND_INTERVAL_MS = 15_000;
export const POLL_INTERVAL_MS = 15_000;
