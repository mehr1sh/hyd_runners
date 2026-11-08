import { describe, expect, it } from "vitest";
import {
  ageLabel,
  elevationStats,
  formatDistance,
  parseAttributes,
  parseGpx,
  parseRouteFilters,
  toWkt,
} from "@/features/routes/logic";

const gpx = (pts: string) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${pts}</trkseg></trk></gpx>`;

describe("GPX parsing", () => {
  it("reads track points with and without elevation, in either attribute order", () => {
    const points = parseGpx(
      gpx(
        `<trkpt lat="17.42" lon="78.42"><ele>540.5</ele></trkpt><trkpt lon="78.43" lat="17.42"/><trkpt lat='17.43' lon='78.43'><ele>545</ele><time>2026-01-01T00:00:00Z</time></trkpt>`,
      ),
    );
    expect(points).toEqual([
      { lat: 17.42, lon: 78.42, ele: 540.5 },
      { lat: 17.42, lon: 78.43, ele: null },
      { lat: 17.43, lon: 78.43, ele: 545 },
    ]);
  });

  it("falls back to route points", () => {
    expect(
      parseGpx(`<gpx><rte><rtept lat="17.4" lon="78.4"/><rtept lat="17.41" lon="78.4"/></rte></gpx>`),
    ).toHaveLength(2);
  });

  it("rejects files that are not usable tracks", () => {
    expect(() => parseGpx("<kml></kml>")).toThrow("not a GPX file");
    expect(() => parseGpx(gpx(`<trkpt lat="17.4" lon="78.4"/>`))).toThrow("at least two points");
    expect(() => parseGpx(gpx(`<trkpt lat="abc" lon="78.4"/><trkpt lat="17.4" lon="78.4"/>`))).toThrow(
      "valid coordinates",
    );
    expect(() => parseGpx(gpx(`<trkpt lat="95" lon="78.4"/><trkpt lat="17.4" lon="78.4"/>`))).toThrow(
      "valid coordinates",
    );
  });
});

describe("elevation", () => {
  const pt = (i: number, ele: number | null) => ({ lat: 17.42 + i * 0.0005, lon: 78.42, ele });

  it("ignores jitter under 3 m and sums real climbs", () => {
    const stats = elevationStats([pt(0, 500), pt(1, 501), pt(2, 499), pt(3, 510), pt(4, 505), pt(5, 520)]);
    expect(stats).toMatchObject({ gain: 25, loss: 5 });
    expect(stats!.profile[0]).toEqual([0, 500]);
    expect(stats!.profile.at(-1)![1]).toBe(520);
  });

  it("never invents elevation when most points lack it", () => {
    expect(elevationStats([pt(0, 500), pt(1, null), pt(2, null)])).toBeNull();
  });

  it("caps the profile at about 200 points", () => {
    const many = Array.from({ length: 5000 }, (_, i) => pt(i, 500 + (i % 10)));
    expect(elevationStats(many)!.profile.length).toBeLessThanOrEqual(201);
  });
});

describe("formatting and forms", () => {
  it("formats distances and ages", () => {
    expect(formatDistance(372.6)).toBe("373 m");
    expect(formatDistance(1234)).toBe("1.23 km");
    expect(formatDistance(21097)).toBe("21.1 km");
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(ageLabel("2026-11-08T08:00:00Z", now)).toBe("today");
    expect(ageLabel("2026-11-05T08:00:00Z", now)).toBe("3 days ago");
  });

  it("writes WKT in lon/lat order", () => {
    expect(
      toWkt([
        { lat: 17.4, lon: 78.4, ele: null },
        { lat: 17.41, lon: 78.42, ele: null },
      ]),
    ).toBe("SRID=4326;LINESTRING(78.4000000 17.4000000, 78.4200000 17.4100000)");
  });

  it("keeps unchecked attributes unknown", () => {
    expect(parseAttributes(new FormData())).toMatchObject({
      ok: true,
      data: { surface: "unknown", beginnerSuitable: null, waterRefill: null, parking: null },
    });
  });

  it("parses route filters", () => {
    expect(parseRouteFilters({ beginner: "1", loop: "0", min: "3", max: "500" })).toEqual({
      beginner: true,
      loop: false,
      verified: false,
      minKm: 3,
      maxKm: null,
    });
  });
});
