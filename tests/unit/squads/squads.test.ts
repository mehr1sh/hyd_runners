import { describe, expect, it } from "vitest";
import { squadAchievements, targetStreak, type SquadWeek } from "@/features/squads/logic";

const w = (km: number, activeMembers = 2): SquadWeek => ({ weekStart: "2026-11-02", km, activeMembers });

describe("squad streaks and achievements", () => {
  it("counts consecutive completed weeks on target, ignoring the current week", () => {
    expect(targetStreak([w(5), w(25), w(30), w(22), w(0)], 20)).toBe(3);
    expect(targetStreak([w(25), w(10), w(40)], 20)).toBe(0);
    expect(targetStreak([w(25)], null)).toBe(0);
  });
  it("awards achievements only from the data", () => {
    const keys = squadAchievements([w(30, 3), w(30, 2), w(30, 2), w(30, 2), w(5, 1)], 20, 3).map((a) => a.key);
    expect(keys).toEqual(["first_target", "streak4", "km100", "all_in"]);
    expect(squadAchievements([w(5), w(5)], 20, 3)).toEqual([]);
  });
});
