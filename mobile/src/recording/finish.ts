/** Turn a finished recording into an upload-queue entry. Pure. */
import { newQueuedRun, type QueuedRun, type UploadPoint } from "../sync/queue";
import type { RecordingMeta } from "./journal";
import { averagePace, elapsedSeconds, movingSeconds, type RecorderState } from "./recorder";

/** The server accepts at most this many points per recording. */
export const MAX_UPLOAD_POINTS = 20_000;

/** Evenly thin a list to at most `max` items, always keeping the first and last. */
export function thin<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

export function toQueuedRun(meta: RecordingMeta, state: RecorderState, name: string | null, now: number): QueuedRun {
  if (state.status !== "finished" || state.startedAt === null) throw new Error("The recording is not finished.");
  const points: UploadPoint[] = thin(state.points, MAX_UPLOAD_POINTS).map((p) => ({
    t: new Date(p.t).toISOString(),
    lat: p.lat,
    lon: p.lon,
    ele: p.ele ?? null,
    acc: p.acc ?? null,
  }));
  return newQueuedRun(
    {
      clientRef: meta.clientRef,
      activityType: meta.activityType,
      name: name?.trim() ? name.trim().slice(0, 120) : null,
      points,
      pauses: state.pauses.map((p) => ({ from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString() })),
      summary: {
        startedAt: state.startedAt,
        distanceM: Math.round(state.distanceM),
        movingS: Math.round(movingSeconds(state, now)),
        elapsedS: Math.round(elapsedSeconds(state, now)),
        averagePace: averagePace(state, now),
      },
    },
    now,
  );
}

/** Same rules as the server: shorter recordings would be rejected, so warn before queueing. */
export function tooShortReason(state: RecorderState, now: number): string | null {
  if (state.points.length < 2) return "No GPS track was recorded.";
  if (elapsedSeconds(state, now) < 60) return "Runs shorter than a minute are not saved.";
  if (state.distanceM < 100) return "Runs shorter than 100 m are not saved.";
  return null;
}

/** Splits per km from kept points (same interpolation idea as the server). */
export function kmSplits(state: RecorderState): { km: number; seconds: number }[] {
  const out: { km: number; seconds: number }[] = [];
  const pts = state.points;
  const cum = state.cumulative;
  let prevT = pts[0]?.t ?? 0;
  let next = 1000;
  for (let i = 1; i < pts.length; i++) {
    while (cum[i] >= next) {
      const span = cum[i] - cum[i - 1];
      const f = span > 0 ? (next - cum[i - 1]) / span : 0;
      const t = pts[i - 1].t + f * (pts[i].t - pts[i - 1].t);
      // Paused time inside the split does not count toward it.
      const paused = state.pauses.reduce((sum, p) => sum + Math.max(0, Math.min(p.to, t) - Math.max(p.from, prevT)), 0);
      out.push({ km: next / 1000, seconds: Math.round((t - prevT - paused) / 1000) });
      prevT = t;
      next += 1000;
    }
  }
  return out;
}
