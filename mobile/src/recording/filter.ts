/**
 * GPS fix filtering. Pure: decides whether a raw location fix is kept for
 * distance and the uploaded track.
 *
 * - inaccurate: the device reports horizontal accuracy worse than maxAccuracyM.
 * - stale: not newer than the last kept fix (duplicate or out of order).
 * - too_fast: implies more than maxSpeedMs from the last kept fix (a GPS
 *   jump; 12 m/s = 43 km/h, the same limit the server uses).
 * - jitter: the fix is within the accuracy radius (3–15 m) of the last kept
 *   fix, or the device reports standing still and it is within the combined
 *   radius. Counting those wobbles inflates distance at traffic lights, so
 *   such fixes are ignored until the runner has really moved.
 */
import { haversine } from "./geo";

export type Fix = {
  /** Epoch milliseconds. */
  t: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres (68% radius), if the OS reports it. */
  acc?: number | null;
  ele?: number | null;
  /** Device speed in m/s, if reported. */
  speed?: number | null;
};

export type FilterOptions = {
  maxAccuracyM: number;
  maxSpeedMs: number;
  /** Minimum movement before a new fix counts, in metres. */
  minJitterM: number;
  /** Cap on the accuracy-based jitter radius, in metres. */
  maxJitterM: number;
  /** Below this device speed, the fix must clear the accuracy-based radius too. */
  stationarySpeedMs: number;
};

export const DEFAULT_FILTER: FilterOptions = {
  maxAccuracyM: 30,
  maxSpeedMs: 12,
  minJitterM: 3,
  maxJitterM: 15,
  stationarySpeedMs: 0.5,
};

export type RejectReason = "invalid" | "inaccurate" | "stale" | "too_fast" | "jitter";
export type FilterResult = { keep: true; meters: number } | { keep: false; reason: RejectReason };

export function isValidFix(f: Fix): boolean {
  return (
    Number.isFinite(f.t) &&
    Number.isFinite(f.lat) &&
    Number.isFinite(f.lon) &&
    Math.abs(f.lat) <= 90 &&
    Math.abs(f.lon) <= 180 &&
    !(f.lat === 0 && f.lon === 0)
  );
}

/**
 * Judge `fix` against the last kept fix (`prev`, null for the first one).
 * `meters` is the distance to add when it is kept.
 */
export function judgeFix(prev: Fix | null, fix: Fix, opts: FilterOptions = DEFAULT_FILTER): FilterResult {
  if (!isValidFix(fix)) return { keep: false, reason: "invalid" };
  if (fix.acc != null && fix.acc > opts.maxAccuracyM) return { keep: false, reason: "inaccurate" };
  if (!prev) return { keep: true, meters: 0 };
  const dt = (fix.t - prev.t) / 1000;
  if (dt <= 0) return { keep: false, reason: "stale" };
  const d = haversine(prev.lat, prev.lon, fix.lat, fix.lon);
  if (d / dt > opts.maxSpeedMs) return { keep: false, reason: "too_fast" };
  // Inside the accuracy circle the fix cannot be told apart from noise. The
  // distance is measured from the last kept fix, so skipping it loses nothing
  // once the runner really moves on.
  const radius = Math.min(opts.maxJitterM, Math.max(opts.minJitterM, fix.acc ?? 0, prev.acc ?? 0));
  if (d <= radius) return { keep: false, reason: "jitter" };
  // Device says standing still: require clearing the combined circle.
  if (fix.speed != null && fix.speed >= 0 && fix.speed < opts.stationarySpeedMs) {
    const combined = Math.min(opts.maxJitterM * 2, (fix.acc ?? 10) + (prev.acc ?? 10));
    if (d <= combined) return { keep: false, reason: "jitter" };
  }
  return { keep: true, meters: d };
}

export type SignalQuality = "none" | "poor" | "fair" | "good";

/**
 * Signal indicator for the recording screen, from the latest fix's accuracy
 * and age. A fix older than `staleAfterMs` means the GPS has gone quiet.
 */
export function signalQuality(
  last: { t: number; acc?: number | null } | null,
  now: number,
  staleAfterMs = 15_000,
): SignalQuality {
  if (!last || now - last.t > staleAfterMs) return "none";
  const acc = last.acc ?? 50;
  if (acc <= 10) return "good";
  if (acc <= 25) return "fair";
  return "poor";
}
