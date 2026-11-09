/**
 * Turns parsed GPX/FIT samples into a validated, normalised activity.
 * Everything here is pure and deterministic so it can be unit tested and so
 * every stored metric can be reproduced from the stored samples.
 *
 * Rules (documented in docs/activities.md):
 * - Timestamps are required; points must be (almost) in time order.
 * - Points implying more than MAX_SPEED_MS from the previous kept point are GPS
 *   glitches and are dropped; more than 10% glitches rejects the file.
 * - Distance is the sum of great-circle distances between kept points.
 *   Without any GPS (e.g. a treadmill FIT file) the device distance is used.
 * - Moving time comes from the device timer when the file has one ("device");
 *   otherwise it is the sum of gaps of at most 30 s where speed is at least
 *   0.5 m/s ("derived").
 * - Elevation, heart rate and cadence are reported only when at least 90%
 *   (elevation) or 50% (heart rate, cadence) of points carry them.
 */

export type RawSample = {
  /** Epoch milliseconds. */
  t: number;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  /** Device-reported cumulative distance in metres, if any. */
  dist: number | null;
  hr: number | null;
  cadence: number | null;
};

export type ActivityType = "run" | "walk_run" | "walk" | "hike";

export type ParsedActivity = {
  format: "gpx" | "fit";
  samples: RawSample[];
  /** From the file (FIT sport / GPX type), if recognisable. */
  detectedType: ActivityType | null;
  /** Device timer time in seconds (FIT session), if any. */
  deviceMovingSeconds: number | null;
  name: string | null;
};

export class ActivityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityValidationError";
  }
}

export const MAX_SPEED_MS = 12; // 43 km/h: impossible on foot.
export const PR_DISTANCES = [
  { key: "1k", meters: 1000, label: "1 km" },
  { key: "1mi", meters: 1609.344, label: "1 mile" },
  { key: "5k", meters: 5000, label: "5 km" },
  { key: "10k", meters: 10000, label: "10 km" },
  { key: "half", meters: 21097.5, label: "Half marathon" },
  { key: "marathon", meters: 42195, label: "Marathon" },
] as const;
export type PrKey = (typeof PR_DISTANCES)[number]["key"];

export type Split = {
  index: number;
  meters: number;
  seconds: number;
  /** Seconds per kilometre for this split. */
  pace: number;
  /** Shorter than the split length (the remainder at the end). */
  partial: boolean;
};

export type NormalizedActivity = {
  startedAt: string;
  endedAt: string;
  elapsedSeconds: number;
  movingSeconds: number;
  movingSource: "device" | "derived";
  distanceMeters: number;
  /** Seconds per km over moving time; null below 100 m. */
  avgPace: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  elevationProfile: [number, number][] | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  kmSplits: Split[];
  mileSplits: Split[];
  /** Fastest time (s) over each record distance the activity covers. */
  bestEfforts: Partial<Record<PrKey, number>>;
  hasGps: boolean;
  /** [lon, lat] pairs, downsampled, for the owner-only full track. */
  path: [number, number][] | null;
  /** The same path with the first and last `trimMeters` removed. */
  publicPath: [number, number][] | null;
  /** [secondsFromStart, lat, lon, ele, cumulativeMeters], downsampled. */
  samples: [number, number | null, number | null, number | null, number][];
  glitchesRemoved: number;
};

const R = 6_371_000;
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoord(s: RawSample) {
  return (
    s.lat !== null &&
    s.lon !== null &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lon) &&
    Math.abs(s.lat) <= 90 &&
    Math.abs(s.lon) <= 180 &&
    !(s.lat === 0 && s.lon === 0)
  );
}

/** Time (s) at which cumulative distance `d` is reached, interpolated. */
function timeAt(cum: number[], times: number[], d: number, from = 0) {
  let i = from;
  while (i < cum.length - 1 && cum[i + 1] < d) i++;
  if (i >= cum.length - 1) return { t: times[times.length - 1], i };
  const span = cum[i + 1] - cum[i];
  const f = span > 0 ? (d - cum[i]) / span : 0;
  return { t: times[i] + f * (times[i + 1] - times[i]), i };
}

export function splitsFor(cum: number[], times: number[], length: number): Split[] {
  const total = cum[cum.length - 1];
  const splits: Split[] = [];
  let prevT = times[0];
  let hint = 0;
  const full = Math.floor(total / length);
  for (let k = 1; k <= full; k++) {
    const { t, i } = timeAt(cum, times, k * length, hint);
    hint = i;
    const seconds = t - prevT;
    splits.push({
      index: k,
      meters: length,
      seconds: Math.round(seconds),
      pace: Math.round((seconds / length) * 1000),
      partial: false,
    });
    prevT = t;
  }
  const rest = total - full * length;
  if (rest >= 100) {
    const seconds = times[times.length - 1] - prevT;
    splits.push({
      index: full + 1,
      meters: Math.round(rest),
      seconds: Math.round(seconds),
      pace: Math.round((seconds / rest) * 1000),
      partial: true,
    });
  }
  return splits;
}

/** Fastest time over `d` metres anywhere in the activity (two pointers, interpolated). */
export function bestEffort(cum: number[], times: number[], d: number): number | null {
  if (cum[cum.length - 1] < d) return null;
  let best = Infinity;
  let j = 0;
  for (let i = 0; i < cum.length; i++) {
    // Window starting at point i: when is cum[i] + d reached?
    const target = cum[i] + d;
    if (target > cum[cum.length - 1]) break;
    if (j < i) j = i;
    while (j < cum.length - 1 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j];
    const f = span > 0 ? (target - cum[j]) / span : 0;
    const t = times[j] + f * (times[j + 1] - times[j]) - times[i];
    if (t > 0 && t < best) best = t;
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

function downsampleIdx(n: number, max: number) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

export function normalizeActivity(
  parsed: ParsedActivity,
  opts: { now?: number; trimMeters?: number } = {},
): NormalizedActivity {
  const now = opts.now ?? Date.now();
  const trimMeters = opts.trimMeters ?? 200;
  const raw = parsed.samples.filter((s) => Number.isFinite(s.t));
  if (raw.length < 2) throw new ActivityValidationError("The file has no timestamped track points.");

  let backwards = 0;
  for (let i = 1; i < raw.length; i++) if (raw[i].t < raw[i - 1].t) backwards++;
  if (backwards > raw.length * 0.01) throw new ActivityValidationError("The file's timestamps are out of order.");
  const sorted = [...raw].sort((a, b) => a.t - b.t).filter((s, i, a) => i === 0 || s.t !== a[i - 1].t);

  if (sorted[0].t < Date.UTC(2000, 0, 1))
    throw new ActivityValidationError("The activity's start time is not plausible.");
  if (sorted[sorted.length - 1].t > now + 86_400_000)
    throw new ActivityValidationError("The activity ends in the future.");

  const withGps = sorted.filter(validCoord);
  const hasGps = withGps.length >= 2 && withGps.length >= sorted.length * 0.5;
  if (!hasGps && sorted.some((s) => s.lat !== null && !validCoord(s)) && withGps.length < 2) {
    throw new ActivityValidationError("The file has invalid coordinates.");
  }

  // Drop GPS glitches (impossible speed from the previous kept point).
  let points = hasGps ? withGps : sorted;
  let glitches = 0;
  if (hasGps) {
    const kept: RawSample[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = kept[kept.length - 1];
      const dt = (points[i].t - prev.t) / 1000;
      const d = haversine(prev.lat!, prev.lon!, points[i].lat!, points[i].lon!);
      if (dt > 0 && d / dt > MAX_SPEED_MS) {
        glitches++;
        continue;
      }
      kept.push(points[i]);
    }
    if (glitches > points.length * 0.1) {
      throw new ActivityValidationError("The track has too many impossible jumps to be a run or walk.");
    }
    points = kept;
  }

  const times = points.map((p) => (p.t - points[0].t) / 1000);
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    if (hasGps) {
      cum.push(cum[i - 1] + haversine(points[i - 1].lat!, points[i - 1].lon!, points[i].lat!, points[i].lon!));
    } else {
      const d = points[i].dist;
      cum.push(d !== null && Number.isFinite(d) ? Math.max(cum[i - 1], d) : cum[i - 1]);
    }
  }
  const distance = cum[cum.length - 1];
  const elapsed = times[times.length - 1];

  if (elapsed < 60) throw new ActivityValidationError("The activity is shorter than a minute.");
  if (elapsed > 48 * 3600) throw new ActivityValidationError("The activity is longer than 48 hours.");
  if (distance < 100) throw new ActivityValidationError("The activity covers less than 100 m.");
  if (distance > 300_000) throw new ActivityValidationError("The activity covers more than 300 km.");
  if (distance / elapsed > MAX_SPEED_MS)
    throw new ActivityValidationError("The average speed is not possible on foot.");

  let moving = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt <= 30 && dt > 0 && (cum[i] - cum[i - 1]) / dt >= 0.5) moving += dt;
  }
  const device = parsed.deviceMovingSeconds;
  const useDevice = device !== null && Number.isFinite(device) && device > 0 && device <= elapsed + 1;
  const movingSeconds = Math.round(useDevice ? device! : moving || elapsed);

  // Elevation with 3 m hysteresis, only when the data is there.
  let elevationGain: number | null = null;
  let elevationLoss: number | null = null;
  let elevationProfile: [number, number][] | null = null;
  if (points.filter((p) => p.ele !== null).length >= points.length * 0.9) {
    let gain = 0;
    let loss = 0;
    let anchor: number | null = null;
    for (const p of points) {
      if (p.ele === null) continue;
      if (anchor === null) anchor = p.ele;
      else if (p.ele - anchor >= 3) {
        gain += p.ele - anchor;
        anchor = p.ele;
      } else if (anchor - p.ele >= 3) {
        loss += anchor - p.ele;
        anchor = p.ele;
      }
    }
    elevationGain = Math.round(gain * 10) / 10;
    elevationLoss = Math.round(loss * 10) / 10;
    elevationProfile = downsampleIdx(points.length, 200)
      .filter((i) => points[i].ele !== null)
      .map((i) => [Math.round(cum[i]), Math.round(points[i].ele! * 10) / 10]);
  }

  const avg = (key: "hr" | "cadence") => {
    const vals = points.map((p) => p[key]).filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
    if (vals.length < points.length * 0.5) return null;
    return { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), max: Math.max(...vals) };
  };
  const hr = avg("hr");
  const cad = avg("cadence");

  const bestEfforts: Partial<Record<PrKey, number>> = {};
  for (const { key, meters } of PR_DISTANCES) {
    const t = bestEffort(cum, times, meters);
    if (t !== null) bestEfforts[key] = t;
  }

  const idx = downsampleIdx(points.length, 2000);
  const path = hasGps ? idx.map((i) => [round7(points[i].lon!), round7(points[i].lat!)] as [number, number]) : null;
  let publicPath: [number, number][] | null = null;
  if (hasGps && distance > trimMeters * 2 + 100) {
    const inner = idx.filter((i) => cum[i] >= trimMeters && cum[i] <= distance - trimMeters);
    if (inner.length >= 2) publicPath = inner.map((i) => [round7(points[i].lon!), round7(points[i].lat!)]);
  }
  const sampleIdx = downsampleIdx(points.length, 3600);

  return {
    startedAt: new Date(points[0].t).toISOString(),
    endedAt: new Date(points[points.length - 1].t).toISOString(),
    elapsedSeconds: Math.round(elapsed),
    movingSeconds,
    movingSource: useDevice ? "device" : "derived",
    distanceMeters: Math.round(distance * 10) / 10,
    avgPace: distance >= 100 ? Math.round((movingSeconds / distance) * 1000) : null,
    elevationGain,
    elevationLoss,
    elevationProfile,
    avgHeartRate: hr?.avg ?? null,
    maxHeartRate: hr?.max ?? null,
    avgCadence: cad?.avg ?? null,
    kmSplits: splitsFor(cum, times, 1000),
    mileSplits: splitsFor(cum, times, 1609.344),
    bestEfforts,
    hasGps,
    path,
    publicPath,
    samples: sampleIdx.map((i) => [
      Math.round(times[i]),
      hasGps ? round7(points[i].lat!) : null,
      hasGps ? round7(points[i].lon!) : null,
      points[i].ele === null ? null : Math.round(points[i].ele! * 10) / 10,
      Math.round(cum[i] * 10) / 10,
    ]),
    glitchesRemoved: glitches,
  };
}

function round7(n: number) {
  return Math.round(n * 1e7) / 1e7;
}
