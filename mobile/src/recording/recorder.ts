/**
 * The run recorder: a pure, event-sourced state machine.
 *
 * Every change is an event (start, fix, pause, resume, finish). The journal
 * persists the events as they happen, and `replay()` rebuilds the exact same
 * state from them after a crash or an OS kill. Nothing here touches the
 * device: the app feeds fixes in and reads metrics out.
 *
 * Time accounting:
 * - elapsed: wall-clock time since start (including pauses).
 * - moving (timer) time: elapsed minus paused time. This is what the server
 *   stores as moving time for app recordings (see docs/mobile.md).
 * - distance: sum of distances between kept fixes. The straight line between
 *   the last fix before a pause and the first after it is counted (as the
 *   server does), so app and web agree.
 */
import { DEFAULT_FILTER, judgeFix, type FilterOptions, type Fix, type RejectReason } from "./filter";
import { haversine, paceSecondsPerKm } from "./geo";

export type RecorderStatus = "idle" | "recording" | "paused" | "finished";

export type RecorderEvent =
  | { type: "start"; t: number }
  | { type: "fix"; fix: Fix }
  | { type: "pause"; t: number }
  | { type: "resume"; t: number }
  | { type: "finish"; t: number };

export type Pause = { from: number; to: number };

export type RecorderState = {
  status: RecorderStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** Kept fixes, in time order. */
  points: Fix[];
  pauses: Pause[];
  /** Start of the current pause while paused. */
  pausedAt: number | null;
  distanceM: number;
  /** Cumulative distance at each kept point (same length as points). */
  cumulative: number[];
  /** The most recent fix received (kept or not), for the signal indicator. */
  lastFix: Fix | null;
  rejected: Partial<Record<RejectReason, number>>;
};

export const initialState = (): RecorderState => ({
  status: "idle",
  startedAt: null,
  finishedAt: null,
  points: [],
  pauses: [],
  pausedAt: null,
  distanceM: 0,
  cumulative: [],
  lastFix: null,
  rejected: {},
});

/** Apply one event. Returns the same object when the event does not apply. */
export function apply(
  state: RecorderState,
  event: RecorderEvent,
  filter: FilterOptions = DEFAULT_FILTER,
): RecorderState {
  switch (event.type) {
    case "start":
      if (state.status !== "idle") return state;
      return { ...initialState(), status: "recording", startedAt: event.t };
    case "pause":
      if (state.status !== "recording") return state;
      return { ...state, status: "paused", pausedAt: event.t };
    case "resume": {
      if (state.status !== "paused" || state.pausedAt === null) return state;
      const to = Math.max(event.t, state.pausedAt);
      return { ...state, status: "recording", pausedAt: null, pauses: [...state.pauses, { from: state.pausedAt, to }] };
    }
    case "finish": {
      if (state.status !== "recording" && state.status !== "paused") return state;
      const pauses =
        state.status === "paused" && state.pausedAt !== null
          ? [...state.pauses, { from: state.pausedAt, to: Math.max(event.t, state.pausedAt) }]
          : state.pauses;
      return { ...state, status: "finished", finishedAt: event.t, pausedAt: null, pauses };
    }
    case "fix": {
      // Fixes only count while recording; while paused they still drive the signal indicator.
      if (state.status === "paused") return { ...state, lastFix: event.fix };
      if (state.status !== "recording" || state.startedAt === null) return state;
      const fix = event.fix;
      if (fix.t < state.startedAt) return { ...state, lastFix: fix };
      const prev = state.points[state.points.length - 1] ?? null;
      const verdict = judgeFix(prev, fix, filter);
      if (!verdict.keep) {
        return {
          ...state,
          lastFix: fix,
          rejected: { ...state.rejected, [verdict.reason]: (state.rejected[verdict.reason] ?? 0) + 1 },
        };
      }
      const distanceM = state.distanceM + verdict.meters;
      return {
        ...state,
        lastFix: fix,
        points: [...state.points, fix],
        cumulative: [...state.cumulative, distanceM],
        distanceM,
      };
    }
  }
}

/** Rebuild state from a persisted event log (crash recovery). */
export function replay(events: readonly RecorderEvent[], filter: FilterOptions = DEFAULT_FILTER): RecorderState {
  let s = initialState();
  for (const e of events) s = applyMutable(s, e, filter);
  return s;
}

/**
 * Same as apply() but appends to the arrays in place. Used for replay and for
 * the live recorder, where copying a 20k-point array on every fix would be
 * wasteful. Callers must not keep references to old states.
 */
export function applyMutable(state: RecorderState, event: RecorderEvent, filter: FilterOptions = DEFAULT_FILTER) {
  if (event.type !== "fix" || state.status !== "recording" || state.startedAt === null) {
    return apply(state, event, filter);
  }
  const fix = event.fix;
  state.lastFix = fix;
  if (fix.t < state.startedAt) return state;
  const prev = state.points[state.points.length - 1] ?? null;
  const verdict = judgeFix(prev, fix, filter);
  if (!verdict.keep) {
    state.rejected[verdict.reason] = (state.rejected[verdict.reason] ?? 0) + 1;
    return state;
  }
  state.distanceM += verdict.meters;
  state.points.push(fix);
  state.cumulative.push(state.distanceM);
  return state;
}

export function pausedSeconds(s: RecorderState, now: number): number {
  let ms = s.pauses.reduce((sum, p) => sum + (p.to - p.from), 0);
  if (s.status === "paused" && s.pausedAt !== null) ms += Math.max(0, now - s.pausedAt);
  return ms / 1000;
}

export function elapsedSeconds(s: RecorderState, now: number): number {
  if (s.startedAt === null) return 0;
  const end = s.finishedAt ?? now;
  return Math.max(0, (end - s.startedAt) / 1000);
}

export function movingSeconds(s: RecorderState, now: number): number {
  return Math.max(0, elapsedSeconds(s, now) - pausedSeconds(s, s.finishedAt ?? now));
}

/**
 * Current pace over the last `windowS` seconds of kept fixes in the current
 * (unpaused) stretch. Null while paused, before enough movement, or when the
 * last fix is older than the window (the runner has stopped).
 */
export function currentPace(s: RecorderState, now: number, windowS = 20): number | null {
  if (s.status !== "recording" || s.points.length < 2) return null;
  const lastPause = s.pauses[s.pauses.length - 1];
  const since = Math.max(now - windowS * 1000, lastPause ? lastPause.to : -Infinity);
  const last = s.points.length - 1;
  if (s.points[last].t < since) return null;
  let i = last;
  while (i > 0 && s.points[i - 1].t >= since) i--;
  if (i === last) i = last - 1;
  if (lastPause && s.points[i].t < lastPause.to) return null;
  const seconds = (s.points[last].t - s.points[i].t) / 1000;
  const meters = s.cumulative[last] - s.cumulative[i];
  return paceSecondsPerKm(seconds, meters, 10);
}

export function averagePace(s: RecorderState, now: number): number | null {
  return paceSecondsPerKm(movingSeconds(s, now), s.distanceM, 50);
}

export type Metrics = {
  status: RecorderStatus;
  distanceM: number;
  elapsedS: number;
  movingS: number;
  currentPace: number | null;
  averagePace: number | null;
  points: number;
};

export function metrics(s: RecorderState, now: number): Metrics {
  return {
    status: s.status,
    distanceM: s.distanceM,
    elapsedS: elapsedSeconds(s, now),
    movingS: movingSeconds(s, now),
    currentPace: currentPace(s, now),
    averagePace: averagePace(s, now),
    points: s.points.length,
  };
}

/** Straight-line distance check used by tests and the summary map fallback. */
export function trackLength(points: readonly Fix[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++)
    d += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return d;
}
