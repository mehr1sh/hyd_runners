import { describe, expect, it } from "vitest";
import { consistency, storySuggestions } from "@/features/storytelling/logic";
import { cardQuery, elevationSvgPath, parseCardOptions } from "@/features/share/logic";

const stats = { km: "10.0 km", time: "55:20", type: "Run", date: "2026-11-08" };

describe("story suggestions", () => {
  it("use only the runner's words and the recorded numbers", () => {
    const s = storySuggestions(
      {
        difficult: "The climb at km 7",
        enjoyed: "Sunrise over the lake",
        ranWith: "Asha",
        achieved: "First 10K without walking",
      },
      stats,
    );
    expect(s[0]).toBe(
      "10.0 km run in 55:20 with Asha. Best bit: sunrise over the lake. Hardest part: the climb at km 7.",
    );
    expect(s).toContain("First 10K without walking. 10.0 km on 2026-11-08, with Asha.");
    for (const line of s) expect(line).not.toMatch(/personal best|record|fastest/i);
  });
  it("leave out sentences for empty answers", () => {
    expect(storySuggestions({ difficult: "", enjoyed: "", ranWith: "", achieved: "" }, stats)).toEqual([
      "10.0 km run in 55:20.",
    ]);
  });
});

describe("wrapped consistency", () => {
  it("counts active weeks and the longest streak", () => {
    expect(consistency(["2026-01-05", "2026-01-07", "2026-01-13", "2026-01-20", "2026-02-10"])).toEqual({
      activeWeeks: 4,
      longestWeekStreak: 3,
    });
  });
});

describe("poster themes", () => {
  it("parse safely and round-trip", () => {
    expect(parseCardOptions(new URLSearchParams("theme=neon")).theme).toBe("neon");
    expect(parseCardOptions(new URLSearchParams("theme=__proto__")).theme).toBe("classic");
    expect(cardQuery({ format: "square", showRoute: true, showPace: true, theme: "elevation" })).toContain(
      "theme=elevation",
    );
  });
  it("draw a closed elevation shape only with real data", () => {
    expect(elevationSvgPath(null, 100, 50)).toBeNull();
    expect(
      elevationSvgPath(
        [
          [0, 500],
          [1000, 520],
          [2000, 510],
        ],
        100,
        50,
      ),
    ).toMatch(/^M0 50 .* Z$/);
  });
});
