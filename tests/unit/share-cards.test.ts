import { describe, expect, it } from "vitest";
import { cardDate, cardQuery, parseCardOptions, routeSvgPath, safeFilename } from "@/features/share/logic";

describe("share card options", () => {
  it("defaults to a square card with route and pace, and ignores unknown formats", () => {
    expect(parseCardOptions(new URLSearchParams(""))).toEqual({ format: "square", showRoute: true, showPace: true });
    expect(parseCardOptions(new URLSearchParams("format=poster&route=0&pace=0"))).toEqual({
      format: "square",
      showRoute: false,
      showPace: false,
    });
    expect(parseCardOptions(new URLSearchParams("format=story")).format).toBe("story");
    expect(parseCardOptions(new URLSearchParams("format=__proto__")).format).toBe("square");
  });

  it("round-trips through the query string", () => {
    const o = { format: "wide" as const, showRoute: false, showPace: true };
    expect(cardQuery(o)).toBe("format=wide&route=0");
    expect(parseCardOptions(new URLSearchParams(cardQuery(o)))).toEqual(o);
  });
});

describe("route drawing", () => {
  it("fits the shape into the box with padding, keeping the aspect ratio", () => {
    const d = routeSvgPath(
      [
        [78.42, 17.42],
        [78.43, 17.42],
        [78.43, 17.43],
      ],
      200,
      200,
      10,
    )!;
    const pts = d
      .split(/[ML]/)
      .filter(Boolean)
      .map((p) => p.trim().split(" ").map(Number));
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(190);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(190);
    }
    // North is up: the last point (further north) is drawn higher.
    expect(pts[2][1]).toBeLessThan(pts[1][1]);
    // Longitude is scaled by cos(latitude), so the east-west leg is shorter than the north-south one.
    expect(pts[1][0] - pts[0][0]).toBeLessThan(pts[1][1] - pts[2][1]);
  });

  it("draws nothing without a shared route and simplifies long tracks to whole pixels", () => {
    expect(routeSvgPath(null, 100, 100)).toBeNull();
    expect(routeSvgPath([[78.4, 17.4]], 100, 100)).toBeNull();
    const long = Array.from(
      { length: 5000 },
      (_, i) => [78.4 + i * 1e-5, 17.4 + Math.sin(i / 100) * 1e-3] as [number, number],
    );
    const d = routeSvgPath(long, 300, 300)!;
    expect(d.split(/[ML]/).filter(Boolean).length).toBeLessThanOrEqual(401);
    expect(d).not.toMatch(/\d\.\d/);
  });
});

describe("card text", () => {
  it("shows the date in Hyderabad time and never the time of day", () => {
    expect(cardDate("2026-11-08T20:00:00Z")).toBe("9 Nov 2026");
    expect(cardDate("2026-11-08T20:00:00Z")).not.toMatch(/:/);
    expect(cardDate(null)).toBe("");
  });

  it("makes safe file names", () => {
    expect(safeFilename("Dawn 5K / Necklace Road!")).toBe("dawn-5k-necklace-road");
    expect(safeFilename("ॐ")).toBe("hyd-runners");
  });
});
