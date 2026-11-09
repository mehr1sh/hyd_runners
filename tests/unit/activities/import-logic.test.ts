import { describe, expect, it } from "vitest";
import {
  ActivityValidationError,
  bestEffort,
  normalizeActivity,
  splitsFor,
} from "@/features/activities/logic/normalize";
import { parseActivityFile, parseActivityGpx, sniffFormat } from "@/features/activities/logic/parse";
import { fit, gpx, track } from "./fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = Date.parse("2026-11-09T00:00:00Z");

describe("format detection", () => {
  it("decides by content, not the file name", async () => {
    expect(sniffFormat(enc(gpx(track({ seconds: 120, speedMs: 3 }))))).toBe("gpx");
    expect(sniffFormat(fit(track({ seconds: 120, speedMs: 3 })))).toBe("fit");
    expect(sniffFormat(enc("<kml></kml>"))).toBeNull();
    await expect(parseActivityFile(enc("hello"))).rejects.toThrow("Upload a GPX or FIT activity file.");
    await expect(parseActivityFile(new Uint8Array())).rejects.toThrow("The file is empty.");
  });
});

describe("GPX activities", () => {
  it("computes distance, pace, splits and best efforts from timestamps", () => {
    // 3 m/s for 30 minutes ≈ 5.4 km at 5:33/km.
    const parsed = parseActivityGpx(gpx(track({ seconds: 1800, speedMs: 3 })));
    const a = normalizeActivity(parsed, { now: NOW });
    expect(a.distanceMeters).toBeGreaterThan(5390);
    expect(a.distanceMeters).toBeLessThan(5410);
    expect(a.elapsedSeconds).toBe(1800);
    expect(a.movingSource).toBe("derived");
    expect(a.avgPace).toBeGreaterThanOrEqual(332);
    expect(a.avgPace).toBeLessThanOrEqual(334);
    expect(a.kmSplits.filter((s) => !s.partial)).toHaveLength(5);
    expect(a.kmSplits[0].pace).toBeGreaterThanOrEqual(332);
    expect(a.kmSplits.at(-1)).toMatchObject({ partial: true });
    expect(a.bestEfforts["5k"]).toBeGreaterThanOrEqual(1664);
    expect(a.bestEfforts["5k"]).toBeLessThanOrEqual(1670);
    expect(a.bestEfforts["10k"]).toBeUndefined();
    expect(a.elevationGain).toBeNull();
    expect(a.avgHeartRate).toBeNull();
  });

  it("reports elevation and heart rate only when the file has them", () => {
    const a = normalizeActivity(
      parseActivityGpx(gpx(track({ seconds: 600, speedMs: 3, ele: (i) => 500 + (i % 40), hr: 150 }))),
      { now: NOW },
    );
    expect(a.elevationGain).toBeGreaterThan(0);
    expect(a.elevationProfile!.length).toBeGreaterThan(1);
    expect(a.avgHeartRate).toBe(150);
  });

  it("drops GPS glitches and rejects tracks full of them", () => {
    const pts = track({ seconds: 600, speedMs: 3 });
    pts[50] = { ...pts[50], lat: pts[50].lat + 0.05 }; // a 5 km jump
    const a = normalizeActivity(parseActivityGpx(gpx(pts)), { now: NOW });
    expect(a.glitchesRemoved).toBe(1);
    expect(a.distanceMeters).toBeLessThan(1900);
    const bad = track({ seconds: 600, speedMs: 3 }).map((p, i) => (i % 3 === 0 ? { ...p, lat: p.lat + 0.05 } : p));
    expect(() => normalizeActivity(parseActivityGpx(gpx(bad)), { now: NOW })).toThrow(ActivityValidationError);
  });

  it("rejects files without usable activity information", () => {
    const noTimes = `<gpx><trk><trkseg><trkpt lat="17.4" lon="78.4"/><trkpt lat="17.41" lon="78.4"/></trkseg></trk></gpx>`;
    expect(() => parseActivityGpx(noTimes)).toThrow(/no timestamps/);
    expect(() =>
      parseActivityGpx(gpx(track({ seconds: 60, speedMs: 3 })).replace("<time>2026", "<time>notadate")),
    ).toThrow("malformed timestamp");
    const future = track({ start: new Date(NOW + 5 * 86_400_000), seconds: 600, speedMs: 3 });
    expect(() => normalizeActivity(parseActivityGpx(gpx(future)), { now: NOW })).toThrow("ends in the future");
    const short = track({ seconds: 30, speedMs: 3 });
    expect(() => normalizeActivity(parseActivityGpx(gpx(short)), { now: NOW })).toThrow("shorter than a minute");
    const reversed = track({ seconds: 600, speedMs: 3 }).reverse();
    expect(() => normalizeActivity(parseActivityGpx(gpx(reversed)), { now: NOW })).toThrow("out of order");
    const driving = track({ seconds: 600, speedMs: 20 });
    expect(() => normalizeActivity(parseActivityGpx(gpx(driving)), { now: NOW })).toThrow(ActivityValidationError);
    expect(() => parseActivityGpx(`<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>`)).toThrow(/entity/);
  });

  it("trims the shared route at both ends and never shares a short route", () => {
    const a = normalizeActivity(parseActivityGpx(gpx(track({ seconds: 900, speedMs: 3 }))), {
      now: NOW,
      trimMeters: 500,
    });
    expect(a.path!.length).toBeGreaterThan(a.publicPath!.length);
    expect(a.publicPath![0][1]).toBeGreaterThan(a.path![0][1] + 500 / 111_195 - 0.0001);
    const tiny = normalizeActivity(parseActivityGpx(gpx(track({ seconds: 300, speedMs: 3 }))), {
      now: NOW,
      trimMeters: 500,
    });
    expect(tiny.publicPath).toBeNull();
  });
});

describe("FIT activities", () => {
  it("parses a FIT file, preferring the device's moving time", async () => {
    const pts = track({ seconds: 1200, speedMs: 3.2, ele: () => 540, hr: 155 });
    const parsed = await parseActivityFile(fit(pts, { timerSeconds: 1150 }));
    expect(parsed).toMatchObject({ format: "fit", detectedType: "run", deviceMovingSeconds: 1150 });
    const a = normalizeActivity(parsed, { now: NOW });
    expect(a.movingSeconds).toBe(1150);
    expect(a.movingSource).toBe("device");
    expect(a.distanceMeters).toBeGreaterThan(3800);
    expect(a.avgHeartRate).toBe(155);
  });

  it("rejects corrupted files and non-foot sports", async () => {
    const bytes = fit(track({ seconds: 300, speedMs: 3 }));
    bytes[bytes.length - 40] ^= 0xff;
    await expect(parseActivityFile(bytes)).rejects.toThrow("corrupted");
    await expect(parseActivityFile(fit(track({ seconds: 300, speedMs: 3 }), { sport: 2 }))).rejects.toThrow(
      /cycling activity/,
    );
  });
});

describe("splits and best efforts", () => {
  it("interpolates split times between points", () => {
    // 0 → 1500 m over 300 s, evenly.
    const cum = [0, 500, 1000, 1500];
    const times = [0, 100, 200, 300];
    expect(splitsFor(cum, times, 1000)).toEqual([
      { index: 1, meters: 1000, seconds: 200, pace: 200, partial: false },
      { index: 2, meters: 500, seconds: 100, pace: 200, partial: true },
    ]);
  });

  it("finds the fastest window, not just the fastest split", () => {
    // Slow 1 km, then a fast 1 km straddling the 1–2 km boundary.
    const cum = [0, 500, 1000, 1500, 2000, 2500];
    const times = [0, 200, 400, 520, 640, 840];
    expect(bestEffort(cum, times, 1000)).toBe(240);
    expect(bestEffort(cum, times, 5000)).toBeNull();
  });
});
