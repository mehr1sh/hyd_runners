import { describe, expect, it } from "vitest";
import { judgeFix, signalQuality } from "./filter";
import { formatDuration, formatPace } from "./geo";
import { MemoryJournalStore, JournaledRecorder, type RecordingMeta } from "./journal";
import { apply, initialState, metrics, replay, type RecorderEvent } from "./recorder";
import { kmSplits, thin, toQueuedRun, tooShortReason } from "./finish";
import { samplingMode, samplingPolicy } from "./sampling";
import { T0, line } from "./test-helpers";

const fixes = (pts: ReturnType<typeof line>): RecorderEvent[] => pts.map((fix) => ({ type: "fix", fix }));

describe("GPS filtering", () => {
  const a = { t: T0, lat: 17.42, lon: 78.42, acc: 5 };

  it("drops fixes worse than 30 m accuracy", () => {
    expect(judgeFix(null, { ...a, acc: 31 })).toEqual({ keep: false, reason: "inaccurate" });
    expect(judgeFix(null, { ...a, acc: 30 })).toMatchObject({ keep: true });
  });

  it("drops impossible speeds (> 12 m/s)", () => {
    const jump = { t: T0 + 1000, lat: 17.42 + 20 / 111_195, lon: 78.42, acc: 5 };
    expect(judgeFix(a, jump)).toEqual({ keep: false, reason: "too_fast" });
  });

  it("drops stale and out-of-order fixes", () => {
    expect(judgeFix(a, { ...a })).toEqual({ keep: false, reason: "stale" });
    expect(judgeFix(a, { ...a, t: T0 - 1000 })).toEqual({ keep: false, reason: "stale" });
  });

  it("drops invalid coordinates", () => {
    expect(judgeFix(null, { ...a, lat: Number.NaN })).toEqual({ keep: false, reason: "invalid" });
    expect(judgeFix(null, { ...a, lat: 0, lon: 0 })).toEqual({ keep: false, reason: "invalid" });
  });

  it("ignores jitter while standing still", () => {
    // 6 m wobble over 20 s with 10 m accuracy: inside the accuracy circle.
    const wobble = { t: T0 + 20_000, lat: 17.42 + 6 / 111_195, lon: 78.42, acc: 10 };
    expect(judgeFix({ ...a, acc: 10 }, wobble)).toEqual({ keep: false, reason: "jitter" });
    // A device-reported zero speed also counts as standing still.
    expect(judgeFix(a, { ...wobble, t: T0 + 2000, speed: 0 })).toEqual({ keep: false, reason: "jitter" });
    // Real movement at running speed with a good fix is kept.
    expect(judgeFix(a, { ...wobble, t: T0 + 2000, acc: 5 })).toMatchObject({ keep: true });
  });

  it("does not accumulate distance from a stationary wobble", () => {
    let s = apply(initialState(), { type: "start", t: T0 });
    for (let i = 0; i < 120; i++) {
      const wobble = (i % 2 ? 1 : -1) * 4;
      s = apply(s, { type: "fix", fix: { t: T0 + i * 1000, lat: 17.42 + wobble / 111_195, lon: 78.42, acc: 10 } });
    }
    expect(s.distanceM).toBeLessThan(10);
    expect(s.rejected.jitter).toBeGreaterThan(100);
  });

  it("rates the signal from accuracy and age", () => {
    expect(signalQuality(null, T0)).toBe("none");
    expect(signalQuality({ t: T0, acc: 5 }, T0)).toBe("good");
    expect(signalQuality({ t: T0, acc: 20 }, T0)).toBe("fair");
    expect(signalQuality({ t: T0, acc: 40 }, T0)).toBe("poor");
    expect(signalQuality({ t: T0, acc: 5 }, T0 + 20_000)).toBe("none");
  });
});

describe("distance, pace and time", () => {
  it("measures a steady run", () => {
    const events: RecorderEvent[] = [{ type: "start", t: T0 }, ...fixes(line({ seconds: 600, speedMs: 3 }))];
    const s = replay(events);
    const m = metrics(s, T0 + 600_000);
    expect(m.distanceM).toBeGreaterThan(1790);
    expect(m.distanceM).toBeLessThan(1810);
    expect(m.elapsedS).toBe(600);
    expect(m.movingS).toBe(600);
    expect(m.averagePace).toBeGreaterThan(330);
    expect(m.averagePace).toBeLessThan(336);
    expect(m.currentPace).toBeGreaterThan(330);
    expect(m.currentPace).toBeLessThan(336);
  });

  it("has no current pace once fixes stop arriving", () => {
    const s = replay([{ type: "start", t: T0 }, ...fixes(line({ seconds: 60, speedMs: 3 }))]);
    expect(metrics(s, T0 + 120_000).currentPace).toBeNull();
  });

  it("formats pace and durations", () => {
    expect(formatPace(307.4)).toBe("5:07");
    expect(formatPace(null)).toBe("–:––");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(65)).toBe("1:05");
  });
});

describe("pause and resume", () => {
  it("excludes paused time from moving time but not from elapsed", () => {
    const events: RecorderEvent[] = [
      { type: "start", t: T0 },
      ...fixes(line({ seconds: 300, speedMs: 3 })),
      { type: "pause", t: T0 + 300_000 },
      // Fixes while paused do not count.
      ...fixes(line({ seconds: 100, speedMs: 3, startS: 310, fromM: 900 })),
      { type: "resume", t: T0 + 420_000 },
      ...fixes(line({ seconds: 300, speedMs: 3, startS: 420, fromM: 900 })),
      { type: "finish", t: T0 + 720_000 },
    ];
    const s = replay(events);
    const m = metrics(s, T0 + 999_999);
    expect(m.status).toBe("finished");
    expect(m.elapsedS).toBe(720);
    expect(m.movingS).toBe(600);
    expect(s.pauses).toEqual([{ from: T0 + 300_000, to: T0 + 420_000 }]);
    expect(m.distanceM).toBeGreaterThan(1790);
    expect(m.distanceM).toBeLessThan(1810);
  });

  it("closes an open pause when finishing while paused", () => {
    const s = replay([
      { type: "start", t: T0 },
      ...fixes(line({ seconds: 120, speedMs: 3 })),
      { type: "pause", t: T0 + 120_000 },
      { type: "finish", t: T0 + 180_000 },
    ]);
    expect(s.pauses).toEqual([{ from: T0 + 120_000, to: T0 + 180_000 }]);
    expect(metrics(s, T0 + 999_000).movingS).toBe(120);
  });

  it("counts the paused clock live and ignores invalid transitions", () => {
    let s = apply(initialState(), { type: "pause", t: T0 });
    expect(s.status).toBe("idle");
    s = apply(s, { type: "start", t: T0 });
    s = apply(s, { type: "resume", t: T0 + 1 });
    expect(s.status).toBe("recording");
    s = apply(s, { type: "pause", t: T0 + 60_000 });
    expect(metrics(s, T0 + 90_000).movingS).toBe(60);
    expect(metrics(s, T0 + 90_000).currentPace).toBeNull();
  });

  it("gives km splits without paused time", () => {
    const s = replay([
      { type: "start", t: T0 },
      ...fixes(line({ seconds: 200, speedMs: 4 })),
      { type: "pause", t: T0 + 200_000 },
      { type: "resume", t: T0 + 260_000 },
      ...fixes(line({ seconds: 200, speedMs: 4, startS: 260, fromM: 800 })),
      { type: "finish", t: T0 + 460_000 },
    ]);
    const splits = kmSplits(s);
    expect(splits).toHaveLength(1);
    expect(splits[0].seconds).toBeGreaterThanOrEqual(249);
    expect(splits[0].seconds).toBeLessThanOrEqual(251);
  });
});

describe("crash recovery", () => {
  const meta: RecordingMeta = {
    clientRef: "3f8a1c2e-0000-4000-8000-000000000001",
    activityType: "run",
    workoutId: null,
    createdAt: T0,
  };

  it("rebuilds the recording from the journal after a crash", async () => {
    const store = new MemoryJournalStore();
    const live = await JournaledRecorder.start(store, meta, T0, { flushEvery: 5 });
    const pts = line({ seconds: 400, speedMs: 3 });
    for (const fix of pts.slice(0, 100)) await live.record({ type: "fix", fix });
    await live.record({ type: "pause", t: T0 + 200_000 });
    await live.record({ type: "resume", t: T0 + 230_000 });
    for (const fix of pts.slice(116, 153)) await live.record({ type: "fix", fix });
    // Crash: the in-memory recorder is gone, unflushed fixes are lost.
    const lost = live.pendingEvents;
    expect(lost).toBeLessThan(5);

    const recovered = await JournaledRecorder.recover(store, T0 + 400_000);
    expect(recovered).not.toBeNull();
    expect(recovered!.meta).toEqual(meta);
    expect(recovered!.state.status).toBe("recording");
    expect(recovered!.state.pauses).toEqual([{ from: T0 + 200_000, to: T0 + 230_000 }]);
    expect(recovered!.state.points.length).toBe(live.state.points.length - lost);
    expect(Math.abs(recovered!.state.distanceM - live.state.distanceM)).toBeLessThan(30);

    // Recording continues on the recovered instance and is journaled.
    await recovered!.record({ type: "finish", t: T0 + 400_000 });
    const again = await JournaledRecorder.recover(store, T0 + 500_000);
    expect(again!.state.status).toBe("finished");
  });

  it("flushes state changes immediately and fixes on a timer", async () => {
    const store = new MemoryJournalStore();
    const r = await JournaledRecorder.start(store, meta, T0, { flushEvery: 100, flushAfterMs: 10_000 });
    expect(store.events).toHaveLength(1);
    const pts = line({ seconds: 18, speedMs: 3 });
    for (const fix of pts) await r.record({ type: "fix", fix });
    // 10 fixes over 18 s: one timed flush at 10 s (6 fixes), 4 still buffered.
    expect(store.events).toHaveLength(7);
    expect(r.pendingEvents).toBe(4);
    await r.record({ type: "pause", t: T0 + 19_000 });
    expect(store.events).toHaveLength(12);
  });

  it("has nothing to recover after discard", async () => {
    const store = new MemoryJournalStore();
    const r = await JournaledRecorder.start(store, meta, T0);
    await r.discard();
    expect(await JournaledRecorder.recover(store, T0)).toBeNull();
  });
});

describe("finishing a recording", () => {
  const meta: RecordingMeta = {
    clientRef: "3f8a1c2e-0000-4000-8000-000000000002",
    activityType: "run",
    workoutId: null,
    createdAt: T0,
  };

  it("builds an upload with ISO times, pauses and a summary", () => {
    const s = replay([
      { type: "start", t: T0 },
      ...fixes(line({ seconds: 300, speedMs: 3 })),
      { type: "pause", t: T0 + 300_000 },
      { type: "finish", t: T0 + 360_000 },
    ]);
    const run = toQueuedRun(meta, s, "  Morning run ", T0 + 400_000);
    expect(run).toMatchObject({ clientRef: meta.clientRef, name: "Morning run", status: "queued", attempts: 0 });
    expect(run.points[0]).toEqual({ t: "2026-11-20T00:30:00.000Z", lat: 17.42, lon: 78.42, ele: null, acc: 5 });
    expect(run.pauses).toEqual([{ from: "2026-11-20T00:35:00.000Z", to: "2026-11-20T00:36:00.000Z" }]);
    expect(run.summary).toMatchObject({ elapsedS: 360, movingS: 300 });
    expect(tooShortReason(s, T0)).toBeNull();
  });

  it("refuses to build an upload from an unfinished recording and flags short runs", () => {
    const s = replay([{ type: "start", t: T0 }, ...fixes(line({ seconds: 30, speedMs: 3 }))]);
    expect(() => toQueuedRun(meta, s, null, T0)).toThrow();
    expect(tooShortReason(s, T0 + 30_000)).toMatch(/minute/);
  });

  it("thins very long tracks to the server limit, keeping both ends", () => {
    const items = Array.from({ length: 25_001 }, (_, i) => i);
    const out = thin(items, 20_000);
    expect(out).toHaveLength(20_000);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(25_000);
  });
});

describe("battery-aware sampling", () => {
  it("uses high accuracy in the foreground and balanced accuracy in the background", () => {
    expect(samplingPolicy(samplingMode(true, false))).toMatchObject({ accuracy: "high" });
    expect(samplingPolicy(samplingMode(false, false))).toMatchObject({ accuracy: "balanced", distanceIntervalM: 10 });
    expect(samplingPolicy(samplingMode(true, true))).toMatchObject({ accuracy: "low" });
  });
});
