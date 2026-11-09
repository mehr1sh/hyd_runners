import { describe, expect, it } from "vitest";
import { pacingAnalysis, runningDna, type DnaActivity } from "@/features/activities/logic/performance";
import type { Split } from "@/features/activities/logic/normalize";

const split = (index: number, pace: number, partial = false): Split => ({
  index,
  meters: partial ? 400 : 1000,
  seconds: pace,
  pace,
  partial,
});

describe("pacing analysis", () => {
  it("recognises negative, positive and even splits", () => {
    expect(pacingAnalysis([split(1, 360), split(2, 355), split(3, 345), split(4, 335)])).toMatchObject({
      kind: "negative",
      firstHalfPace: 358,
      secondHalfPace: 340,
      fastest: { index: 4 },
      slowest: { index: 1 },
    });
    expect(pacingAnalysis([split(1, 330), split(2, 340), split(3, 360), split(4, 380)])?.kind).toBe("positive");
    expect(pacingAnalysis([split(1, 340), split(2, 341), split(3, 339), split(4, 340)])).toMatchObject({
      kind: "even",
      consistency: "very even",
    });
  });

  it("ignores the partial last split and needs two full kilometres", () => {
    expect(pacingAnalysis([split(1, 340), split(2, 340), split(3, 200, true)])?.kind).toBe("even");
    expect(pacingAnalysis([split(1, 340), split(2, 300, true)])).toBeNull();
    expect(pacingAnalysis(null)).toBeNull();
  });
});

const act = (weeksAgo: number, distanceM: number, weekday = 3, avgPace: number | null = 360): DnaActivity => ({
  startedAt: "2026-11-01T00:00:00Z",
  weekday,
  weeksAgo,
  distanceM,
  avgPace,
  type: "run",
});

describe("running DNA", () => {
  it("says nothing without enough recent data", () => {
    expect(runningDna([act(0, 5000), act(1, 5000), act(2, 5000)])).toEqual({
      traits: [],
      trend: null,
      enoughData: false,
    });
  });

  it("finds consistency, weekend running and a growing long run, with evidence", () => {
    const acts = [0, 1, 2, 3, 4, 5, 6].map((w) => act(w, w < 4 ? 12000 : 6000, 6));
    const dna = runningDna(acts);
    expect(dna.traits.map((t) => t.key)).toEqual(["consistency", "weekend", "builder"]);
    expect(dna.traits[0].evidence).toBe("You were active in 7 of the last 8 weeks.");
    expect(dna.traits[2].evidence).toContain("12 km");
    expect(dna.trend).toContain("higher");
  });

  it("recognises getting faster and coming back", () => {
    const faster = [act(0, 5000, 2, 330), act(1, 5000, 2, 330), act(5, 5000, 2, 360), act(6, 5000, 2, 360)];
    expect(runningDna(faster).traits.map((t) => t.key)).toContain("speed");
    const comeback = [act(0, 5000), act(1, 5000), act(6, 5000), act(7, 5000)];
    expect(runningDna(comeback).traits.map((t) => t.key)).toContain("comeback");
  });

  it("does not invent traits from ordinary weeks", () => {
    const plain = [act(0, 5000, 2), act(2, 5000, 3), act(5, 5000, 2), act(7, 5000, 4)];
    expect(runningDna(plain).traits).toEqual([]);
  });
});
