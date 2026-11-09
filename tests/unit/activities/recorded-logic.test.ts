import { describe, expect, it } from "vitest";
import { ActivityValidationError, normalizeActivity } from "@/features/activities/logic/normalize";
import {
  MAX_RECORDED_POINTS,
  RecordedActivityBody,
  canonicalRecording,
  mergePauses,
  recordedToParsed,
} from "@/features/activities/logic/recorded";
import { track } from "./fixtures";

const NOW = Date.parse("2026-11-09T00:00:00Z");
const REF = "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";

function body(points = track({ seconds: 900, speedMs: 3 }), extra: Record<string, unknown> = {}) {
  return {
    clientRef: REF,
    activityType: "run",
    points: points.map((p) => ({ t: p.t.toISOString(), lat: p.lat, lon: p.lon, ele: p.ele, acc: 5 })),
    ...extra,
  };
}

describe("recorded activity validation", () => {
  it("accepts a well-formed recording and defaults the type and pauses", () => {
    const parsed = RecordedActivityBody.parse({ ...body(), activityType: undefined });
    expect(parsed.activityType).toBe("run");
    expect(parsed.pauses).toEqual([]);
  });

  it("rejects a missing or malformed client reference", () => {
    expect(RecordedActivityBody.safeParse({ ...body(), clientRef: "abc" }).success).toBe(false);
    const { clientRef: _omit, ...rest } = body();
    void _omit;
    expect(RecordedActivityBody.safeParse(rest).success).toBe(false);
  });

  it("rejects out-of-range coordinates, bad timestamps and unknown activity types", () => {
    const b = body();
    expect(RecordedActivityBody.safeParse({ ...b, points: [{ ...b.points[0], lat: 91 }, b.points[1]] }).success).toBe(
      false,
    );
    expect(
      RecordedActivityBody.safeParse({ ...b, points: [{ ...b.points[0], t: "yesterday" }, b.points[1]] }).success,
    ).toBe(false);
    expect(RecordedActivityBody.safeParse({ ...b, activityType: "swim" }).success).toBe(false);
  });

  it("caps the number of points", () => {
    const p = body().points[0];
    const many = Array.from({ length: MAX_RECORDED_POINTS + 1 }, () => p);
    expect(RecordedActivityBody.safeParse({ ...body(), points: many }).success).toBe(false);
  });

  it("rejects pauses that end before they start", () => {
    const r = RecordedActivityBody.safeParse(
      body(undefined, { pauses: [{ from: "2026-11-01T00:40:00Z", to: "2026-11-01T00:39:00Z" }] }),
    );
    expect(r.success).toBe(false);
  });
});

describe("recorded activity conversion", () => {
  it("produces the same metrics as the equivalent GPX import", () => {
    const a = normalizeActivity(recordedToParsed(RecordedActivityBody.parse(body())), { now: NOW });
    expect(a.distanceMeters).toBeGreaterThan(2690);
    expect(a.distanceMeters).toBeLessThan(2710);
    expect(a.elapsedSeconds).toBe(900);
    expect(a.movingSource).toBe("device");
    expect(a.movingSeconds).toBe(900);
    expect(a.kmSplits.filter((s) => !s.partial)).toHaveLength(2);
    expect(a.bestEfforts["1k"]).toBeGreaterThan(330);
  });

  it("drops inaccurate fixes", () => {
    const b = RecordedActivityBody.parse(body());
    b.points[10] = { ...b.points[10], lat: b.points[10].lat + 0.001, acc: 120 };
    const parsed = recordedToParsed(b);
    expect(parsed.samples).toHaveLength(b.points.length - 1);
  });

  it("uses timer time (elapsed minus pauses) as moving time and drops fixes inside pauses", () => {
    const pts = track({ seconds: 1200, speedMs: 3 });
    const pauses = [
      { from: "2026-11-01T00:35:00Z", to: "2026-11-01T00:37:00Z" },
      // Overlapping pause windows are merged, not counted twice.
      { from: "2026-11-01T00:36:00Z", to: "2026-11-01T00:38:00Z" },
    ];
    const parsed = recordedToParsed(RecordedActivityBody.parse(body(pts, { pauses })));
    expect(parsed.deviceMovingSeconds).toBe(1200 - 180);
    expect(
      parsed.samples.some((s) => s.t > Date.parse("2026-11-01T00:35:00Z") && s.t < Date.parse("2026-11-01T00:38:00Z")),
    ).toBe(false);
    const a = normalizeActivity(parsed, { now: NOW });
    expect(a.movingSource).toBe("device");
    expect(a.movingSeconds).toBe(1020);
  });

  it("merges pause windows", () => {
    expect(
      mergePauses([
        { from: "2026-11-01T00:10:00Z", to: "2026-11-01T00:11:00Z" },
        { from: "2026-11-01T00:00:00Z", to: "2026-11-01T00:05:00Z" },
        { from: "2026-11-01T00:04:00Z", to: "2026-11-01T00:06:00Z" },
      ]).map(([a, b]) => (b - a) / 1000),
    ).toEqual([360, 60]);
  });

  it("refuses a recording without enough accurate points", () => {
    const b = RecordedActivityBody.parse(body());
    for (const p of b.points) p.acc = 80;
    expect(() => recordedToParsed(b)).toThrow(ActivityValidationError);
  });

  it("serialises a recording canonically so retries hash the same", () => {
    const b = RecordedActivityBody.parse(body());
    expect(canonicalRecording(b)).toEqual(canonicalRecording(RecordedActivityBody.parse(body())));
  });
});
