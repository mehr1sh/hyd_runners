import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING, joinCode, scoringFor, SCORING_LABEL } from "@/features/leagues/logic";

describe("league scoring", () => {
  it("never scores speed and labels every metric", () => {
    expect(Object.keys(DEFAULT_SCORING).sort()).toEqual(Object.keys(SCORING_LABEL).sort());
    expect(Object.keys(SCORING_LABEL).some((k) => /pace|speed|fast/.test(k))).toBe(false);
  });
  it("consistency and beginner leagues ignore distance", () => {
    expect(scoringFor("consistency").per_5km).toBe(0);
    expect(scoringFor("beginner").consistent_week).toBeGreaterThan(DEFAULT_SCORING.consistent_week);
    expect(scoringFor("club").group_run).toBeGreaterThan(DEFAULT_SCORING.group_run);
  });
  it("makes join codes the database accepts", () => {
    for (let i = 0; i < 20; i++) expect(joinCode()).toMatch(/^[A-Z0-9]{6,12}$/);
  });
});
