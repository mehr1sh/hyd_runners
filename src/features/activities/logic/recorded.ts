/**
 * Runs recorded by the HYD Runners mobile app (POST /api/v1/activities/recorded).
 *
 * The app sends its raw GPS fixes plus the pauses the runner made. They are
 * turned into the same ParsedActivity a GPX/FIT file produces, so recorded runs
 * go through normalizeActivity() and finalize_activity_import() and get the
 * same metrics, best efforts, privacy trimming and duplicate detection.
 *
 * Pure: no I/O, so it is unit tested directly.
 */
import { z } from "zod";
import { ActivityValidationError, type ParsedActivity, type RawSample } from "./normalize";

export const MAX_RECORDED_POINTS = 20_000;
/** Fixes reported by the device as worse than this are dropped server-side too. */
export const MAX_RECORDED_ACCURACY_M = 50;
/** Request bodies above this are refused before parsing (20k points is ~2 MB). */
export const MAX_RECORDED_BODY_BYTES = 4 * 1024 * 1024;

const iso = z.iso.datetime({ offset: true });

export const RecordedPoint = z.object({
  t: iso,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  ele: z.number().min(-500).max(9000).nullish(),
  acc: z.number().min(0).max(10_000).nullish(),
});

export const RecordedActivityBody = z
  .object({
    clientRef: z.uuid(),
    activityType: z.enum(["run", "walk_run", "walk", "hike"]).default("run"),
    name: z.string().trim().max(120).nullish(),
    points: z.array(RecordedPoint).min(2).max(MAX_RECORDED_POINTS),
    pauses: z
      .array(z.object({ from: iso, to: iso }))
      .max(500)
      .default([]),
  })
  .refine((b) => b.pauses.every((p) => Date.parse(p.to) >= Date.parse(p.from)), {
    message: "Each pause must end after it starts.",
    path: ["pauses"],
  });

export type RecordedActivityInput = z.infer<typeof RecordedActivityBody>;

/** Merge overlapping pause windows into sorted, disjoint [from, to] ms pairs. */
export function mergePauses(pauses: { from: string; to: string }[]): [number, number][] {
  const sorted = pauses
    .map((p) => [Date.parse(p.from), Date.parse(p.to)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * Convert an app recording into a ParsedActivity.
 *
 * - Fixes worse than MAX_RECORDED_ACCURACY_M and fixes inside a pause are dropped.
 * - When the runner paused, moving time is the timer time (elapsed minus the
 *   pauses inside the track), reported as "device" like a watch's FIT timer.
 *   Without pauses the normaliser derives moving time from speed.
 */
export function recordedToParsed(input: RecordedActivityInput): ParsedActivity {
  const pauses = mergePauses(input.pauses);
  const inPause = (t: number) => pauses.some(([from, to]) => t > from && t < to);
  const samples: RawSample[] = input.points
    .filter((p) => p.acc == null || p.acc <= MAX_RECORDED_ACCURACY_M)
    .map((p) => ({
      t: Date.parse(p.t),
      lat: p.lat,
      lon: p.lon,
      ele: p.ele ?? null,
      dist: null,
      hr: null,
      cadence: null,
    }))
    .filter((s) => !inPause(s.t))
    .sort((a, b) => a.t - b.t);
  if (samples.length < 2) throw new ActivityValidationError("The recording has too few accurate GPS points.");

  let deviceMovingSeconds: number | null = null;
  if (pauses.length > 0) {
    const start = samples[0].t;
    const end = samples[samples.length - 1].t;
    let paused = 0;
    for (const [from, to] of pauses) paused += Math.max(0, Math.min(to, end) - Math.max(from, start));
    const timer = Math.round((end - start - paused) / 1000);
    deviceMovingSeconds = timer > 0 ? timer : null;
  }

  return {
    format: "app",
    samples,
    detectedType: input.activityType,
    deviceMovingSeconds,
    name: input.name || null,
  };
}

/**
 * The bytes kept in storage as the original of a recording (the import's
 * "file"), in a canonical form so the same recording hashes the same.
 */
export function canonicalRecording(input: RecordedActivityInput): Uint8Array {
  const body = {
    version: 1,
    clientRef: input.clientRef,
    activityType: input.activityType,
    points: input.points.map((p) => [p.t, p.lat, p.lon, p.ele ?? null, p.acc ?? null]),
    pauses: mergePauses(input.pauses).map(([from, to]) => [new Date(from).toISOString(), new Date(to).toISOString()]),
  };
  return new TextEncoder().encode(JSON.stringify(body));
}
