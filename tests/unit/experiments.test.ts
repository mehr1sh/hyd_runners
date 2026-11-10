import { describe, expect, it } from "vitest";
import { ghostComparison, JOURNEYS, relayStatus, roulettePick } from "@/features/experiments/logic";

describe("ghost runner", () => {
  it("compares cumulative time at shared full kilometres only", () => {
    const g = ghostComparison(
      [
        { index: 1, seconds: 300 },
        { index: 2, seconds: 310 },
        { index: 3, seconds: 150, partial: true },
      ],
      [
        { index: 1, seconds: 320 },
        { index: 2, seconds: 300 },
        { index: 3, seconds: 290 },
      ],
    );
    expect(g.rows).toEqual([
      { km: 1, current: 300, ghost: 320, delta: -20, splitDelta: -20 },
      { km: 2, current: 610, ghost: 620, delta: -10, splitDelta: 10 },
    ]);
    expect(g.final).toBe(-10);
  });
  it("has nothing to compare without splits", () => {
    expect(ghostComparison([], [{ index: 1, seconds: 300 }]).final).toBeNull();
  });
});

describe("virtual relay", () => {
  it("tracks checkpoints and never exceeds the journey", () => {
    expect(relayStatus("hyd_bengaluru", 300)).toMatchObject({
      passed: ["Kurnool"],
      next: { name: "Anantapur", kmToGo: 60 },
      finished: false,
    });
    expect(relayStatus("hyd_bengaluru", 900)).toMatchObject({ pct: 100, next: null, finished: true });
    expect(JOURNEYS.around_the_world.km).toBe(40075);
  });
});

describe("run roulette", () => {
  it("picks only from the routes given", () => {
    expect(roulettePick([], 0.5)).toBeNull();
    expect(roulettePick(["a", "b", "c"], 0.99)).toBe("c");
    expect(roulettePick(["a", "b", "c"], 0)).toBe("a");
  });
});
