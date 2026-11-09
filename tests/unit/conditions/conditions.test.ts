import { describe, expect, it, vi } from "vitest";
import met from "./met-norway-hyderabad.json";
import {
  heatIndexC,
  isDark,
  recommend,
  scoreForecast,
  scoreHour,
  sunTimes,
  type Forecast,
  type HourConditions,
} from "@/features/conditions/logic";

vi.mock("server-only", () => ({}));
const { parseMetNorway, sampleForecast } = await import("@/features/conditions/providers");

const HYD = { lat: 17.385, lon: 78.4867 };
const hour = (o: Partial<HourConditions> = {}): HourConditions => ({
  time: "2026-11-09T01:00:00.000Z",
  tempC: 22,
  apparentC: 22,
  humidityPct: 50,
  dewPointC: 12,
  windMs: 2,
  uvClearSky: 1,
  precipMm: 0,
  aqi: null,
  ...o,
});

describe("MET Norway parsing (real Hyderabad response)", () => {
  it("normalises hourly entries", () => {
    const { updatedAt, hours } = parseMetNorway(met);
    expect(updatedAt).toBe("2026-11-09T09:21:54Z");
    expect(hours).toHaveLength(30);
    expect(hours[0]).toEqual({
      time: "2026-11-09T10:00:00.000Z",
      tempC: 29.2,
      apparentC: 29.2,
      humidityPct: 30.6,
      dewPointC: 10.2,
      windMs: 3.3,
      uvClearSky: 1.6,
      precipMm: 0,
      aqi: null,
    });
  });

  it("rejects unexpected payloads and skips non-hourly entries", () => {
    expect(() => parseMetNorway({ nope: true })).toThrow();
    const sixHourly = {
      properties: {
        timeseries: [{ time: "2026-11-09T00:00:00Z", data: { instant: { details: { air_temperature: 20 } } } }],
      },
    };
    expect(parseMetNorway(sixHourly).hours).toEqual([]);
  });
});

describe("hour scores", () => {
  it("rates a cool, dry, still hour as good with no reasons", () => {
    expect(scoreHour(hour(), false)).toEqual({ score: 100, level: "good", reasons: [], dark: false });
  });

  it("explains every deduction", () => {
    const s = scoreHour(hour({ apparentC: 31, dewPointC: 21, precipMm: 1.2, windMs: 10, uvClearSky: 9 }), false);
    expect(s.reasons).toEqual([
      "Hot: feels like 31°C",
      "Humid (dew point 21°C)",
      "Rain expected (1.2 mm)",
      "Strong wind (36 km/h)",
      "Very high UV (9 on a clear sky)",
    ]);
    expect(s.score).toBe(0); // 100 - 30 - 8 - 30 - 15 - 20, clamped
    expect(s.level).toBe("poor");
  });

  it("says avoid for dangerous heat, heavy rain, very strong wind or very unhealthy air", () => {
    for (const o of [{ apparentC: 39 }, { precipMm: 5 }, { windMs: 15 }, { aqi: 250 }])
      expect(scoreHour(hour(o), false)).toMatchObject({ level: "avoid", score: 0 });
  });

  it("ignores UV in the dark and notes darkness", () => {
    const s = scoreHour(hour({ uvClearSky: 9 }), true);
    expect(s.reasons).toEqual(["Dark: pick a lit route and wear something visible"]);
    expect(s.score).toBe(95);
  });

  it("falls back to a heat index from humidity", () => {
    expect(heatIndexC(20, 90)).toBe(20);
    expect(heatIndexC(32, 70)).toBeGreaterThan(38);
    expect(scoreHour(hour({ tempC: 32, apparentC: null, humidityPct: 70 }), false).level).toBe("avoid");
  });
});

describe("sun times", () => {
  it("matches published Hyderabad times within a few minutes", () => {
    // 9 Nov 2026, Hyderabad: sunrise ≈ 06:17, sunset ≈ 17:41 IST.
    const { sunrise, sunset } = sunTimes(Date.parse("2026-11-09T06:30:00Z"), HYD.lat, HYD.lon);
    expect(Math.abs(sunrise - Date.parse("2026-11-09T00:47:00Z"))).toBeLessThan(6 * 60_000);
    expect(Math.abs(sunset - Date.parse("2026-11-09T12:11:00Z"))).toBeLessThan(6 * 60_000);
    expect(isDark(Date.parse("2026-11-08T23:30:00Z"), HYD.lat, HYD.lon)).toBe(true); // 05:00 IST
    expect(isDark(Date.parse("2026-11-09T06:30:00Z"), HYD.lat, HYD.lon)).toBe(false); // noon IST
  });
});

describe("run now or later", () => {
  const forecastOf = (hours: HourConditions[]): Forecast => ({
    source: "sample",
    live: false,
    attribution: "",
    attributionUrl: "",
    updatedAt: null,
    hours,
  });
  const series = (start: string, apparent: number[]) =>
    apparent.map((a, i) =>
      hour({ time: new Date(Date.parse(start) + i * 3_600_000).toISOString(), apparentC: a, tempC: a }),
    );

  it("says go now when it is good and nothing is clearly better", () => {
    const hours = scoreForecast(
      forecastOf(series("2026-11-09T01:00:00Z", [22, 23, 24, 30])),
      Date.parse("2026-11-09T01:10:00Z"),
      HYD.lat,
      HYD.lon,
    );
    expect(recommend(hours)).toMatchObject({ kind: "now" });
  });

  it("suggests a clearly better later hour, only at sensible running hours", () => {
    // Now: 13:30 IST, very hot. Cooler in the evening; coolest at 02:00 IST, which is never suggested.
    const apparent = [36, 35, 33, 31, 28, 26, 25, 25, 24, 24, 23, 22, 21, 20];
    const hours = scoreForecast(
      forecastOf(series("2026-11-09T08:00:00Z", apparent)),
      Date.parse("2026-11-09T08:00:00Z"),
      HYD.lat,
      HYD.lon,
    );
    const rec = recommend(hours);
    expect(rec.kind).toBe("later");
    if (rec.kind !== "later") return;
    const localHour = new Date(Date.parse(rec.best.time) + 330 * 60_000).getUTCHours();
    expect(localHour).toBeGreaterThanOrEqual(5);
    expect(localHour).toBeLessThanOrEqual(21);
    expect(rec.best.score - rec.now.score).toBeGreaterThanOrEqual(15);
  });

  it("admits when there is no good window", () => {
    const hours = scoreForecast(
      forecastOf(series("2026-11-09T06:00:00Z", Array(13).fill(40))),
      Date.parse("2026-11-09T06:00:00Z"),
      HYD.lat,
      HYD.lon,
    );
    expect(recommend(hours).kind).toBe("none_good");
    expect(recommend([])).toEqual({ kind: "no_data" });
  });

  it("drops past hours and caps the window", () => {
    const f = forecastOf(series("2026-11-09T00:00:00Z", Array(40).fill(22)));
    const hours = scoreForecast(f, Date.parse("2026-11-09T03:40:00Z"), HYD.lat, HYD.lon, 24);
    expect(hours[0].time).toBe("2026-11-09T03:00:00.000Z");
    expect(hours).toHaveLength(24);
  });
});

describe("sample provider", () => {
  it("is labelled as not live", () => {
    const f = sampleForecast(Date.parse("2026-11-09T03:40:00Z"));
    expect(f).toMatchObject({
      source: "sample",
      live: false,
      attribution: "Sample data for testing. Not live weather.",
    });
    expect(f.hours[0].time).toBe("2026-11-09T03:00:00.000Z");
    expect(f.hours).toHaveLength(36);
  });
});
