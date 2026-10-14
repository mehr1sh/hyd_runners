import { describe, expect, it } from "vitest";
import { dailyStreak, streakRuns, streakSeries, weeklyStreak } from "@/features/gamification/logic/streaks";
import { addDays, localDate, localMidnightUtc, weekStart } from "@/features/gamification/logic/time";

describe("local calendar days", () => {
  it("uses the IST date, not the UTC date", () => {
    // 00:30 IST on 15 Oct is still 14 Oct in UTC.
    expect(localDate("2026-10-14T19:00:00Z")).toBe("2026-10-15");
    expect(localDate("2026-10-14T18:29:00Z")).toBe("2026-10-14");
  });

  it("finds local midnight with the +05:30 offset", () => {
    expect(localMidnightUtc("2026-10-15").toISOString()).toBe("2026-10-14T18:30:00.000Z");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday → Monday
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
});

describe("habit streak", () => {
  it("allows one rest day between workouts", () => {
    const runs = streakRuns(["2026-10-01", "2026-10-03", "2026-10-05"]);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(5);
  });

  it("breaks after two consecutive rest days", () => {
    expect(streakRuns(["2026-10-01", "2026-10-04"])).toHaveLength(2);
  });

  it("stays alive (at risk) the day after a rest day, then breaks", () => {
    const dates = ["2026-10-10", "2026-10-11"];
    expect(dailyStreak(dates, "2026-10-12")).toMatchObject({ current: 2, atRisk: false });
    expect(dailyStreak(dates, "2026-10-13")).toMatchObject({ current: 2, atRisk: true });
    expect(dailyStreak(dates, "2026-10-14")).toMatchObject({ current: 0, longest: 2 });
  });

  it("counts a late-night IST workout on the right day across the UTC boundary", () => {
    // 23:50 IST on 10 Oct and 00:10 IST on 12 Oct: one rest day (11th) → streak continues.
    const d1 = localDate("2026-10-10T18:20:00Z");
    const d2 = localDate("2026-10-11T18:40:00Z");
    expect([d1, d2]).toEqual(["2026-10-10", "2026-10-12"]);
    expect(dailyStreak([d1, d2], "2026-10-12").current).toBe(3);
  });

  it("produces a day-by-day series for charts", () => {
    const series = streakSeries(["2026-10-01", "2026-10-03"], "2026-10-01", "2026-10-06");
    expect(series.map((s) => s.streak)).toEqual([1, 1, 3, 3, 3, 0]);
  });
});

describe("weekly streak", () => {
  it("counts consecutive weeks with 3+ active days and tolerates the week in progress", () => {
    const wk = (start: string) => [start, addDays(start, 2), addDays(start, 4)];
    const dates = [...wk("2026-09-28"), ...wk("2026-10-05")];
    expect(weeklyStreak(dates, "2026-10-13")).toEqual({ current: 2, longest: 2 }); // current week not done yet
    expect(weeklyStreak(dates, "2026-10-20").current).toBe(0);
  });
});
