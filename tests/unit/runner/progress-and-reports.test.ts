import { describe, expect, it } from "vitest";
import { programmeProgress, restDays } from "@/features/workouts/logic/programme-progress";
import { checkPlausibility } from "@/features/workouts/logic/validate";
import { buildReport, periodRange } from "@/features/reports/logic/aggregate";
import { motivationalMessage } from "@/features/gamification/logic/motivation";

const sessions = [1, 2].flatMap((week) =>
  [1, 3, 5].map((day) => ({
    id: `w${week}d${day}`,
    week,
    day,
    title: `W${week}D${day}`,
    workoutType: "walk_run",
    estimatedMinutes: 30,
  })),
);

describe("programme progress", () => {
  it("returns the next session in order and the completed weeks", () => {
    const p = programmeProgress({
      sessions,
      completed: ["w1d1", "w1d3", "w1d5"].map((id, i) => ({ sessionId: id, localDate: `2026-10-0${1 + i * 2}` })),
      today: "2026-10-08",
      durationWeeks: 2,
    });
    expect(p).toMatchObject({ completed: 3, total: 6, percent: 50, currentWeek: 2, weeksCompleted: [1] });
    expect(p.next?.id).toBe("w2d1");
    expect(p.restRecommended).toBe(false);
  });

  it("recommends a rest day after a session yesterday", () => {
    const p = programmeProgress({
      sessions,
      completed: [{ sessionId: "w1d1", localDate: "2026-10-07" }],
      today: "2026-10-08",
      durationWeeks: 2,
    });
    expect(p.restRecommended).toBe(true);
    expect(p.nextRecommendedDate).toBe("2026-10-09");
  });

  it("lists rest days between sessions", () => {
    expect(restDays([1, 3, 5])).toEqual([2, 4, 6, 7]);
  });
});

describe("workout plausibility", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("rejects impossible running speeds", () => {
    expect(
      checkPlausibility({
        workoutType: "run",
        startedAt: new Date("2026-10-14T10:00:00Z"),
        durationSeconds: 600,
        distanceMeters: 10_000,
        now,
      }),
    ).toMatch(/pace/);
  });
  it("rejects future and old entries unless backdating is allowed", () => {
    expect(
      checkPlausibility({
        workoutType: "walk",
        startedAt: new Date("2026-10-14T13:00:00Z"),
        durationSeconds: 600,
        distanceMeters: null,
        now,
      }),
    ).toMatch(/future/);
    const old = new Date("2026-09-01T10:00:00Z");
    expect(
      checkPlausibility({ workoutType: "walk", startedAt: old, durationSeconds: 600, distanceMeters: null, now }),
    ).toMatch(/7 days/);
    expect(
      checkPlausibility({
        workoutType: "walk",
        startedAt: old,
        durationSeconds: 600,
        distanceMeters: null,
        now,
        allowBackdate: true,
      }),
    ).toBeNull();
  });
});

describe("reports", () => {
  const w = (
    iso: string,
    minutes: number,
    type: "run" | "mobility" = "run",
    km: number | null = null,
    planned = false,
  ) => ({
    startedAt: iso,
    durationSeconds: minutes * 60,
    distanceMeters: km === null ? null : km * 1000,
    workoutType: type,
    planned,
  });
  const workouts = [
    w("2026-10-12T01:00:00Z", 30, "run", 3, true),
    w("2026-10-14T13:00:00Z", 20, "mobility"),
    w("2026-10-15T19:00:00Z", 40, "run", 5), // 00:30 IST on 16 Oct
    w("2026-10-05T01:00:00Z", 30, "run", 3), // previous week
  ];

  it("aggregates a local Mon–Sun week", () => {
    const range = periodRange("week", "2026-10-15");
    expect(range).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    const r = buildReport({
      period: "week",
      range,
      workouts,
      allActiveDates: ["2026-10-05", "2026-10-12", "2026-10-14", "2026-10-16"],
      plannedCount: 3,
      timezone: "Asia/Kolkata",
      today: "2026-10-18",
    });
    expect(r).toMatchObject({
      workoutCount: 3,
      activeSeconds: 90 * 60,
      runDistanceMeters: 8000,
      activeDays: 3,
      isEmpty: false,
    });
    expect(r.planned).toEqual({ planned: 3, completed: 1 });
    expect(r.series.map((s) => s.workouts)).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(r.byType[0]).toMatchObject({ type: "run", count: 2, minutes: 70 });
  });

  it("returns an empty report for a period without workouts", () => {
    const r = buildReport({
      period: "month",
      range: periodRange("month", "2026-08-10"),
      workouts,
      allActiveDates: [],
      plannedCount: null,
      timezone: "Asia/Kolkata",
      today: "2026-10-18",
    });
    expect(r.isEmpty).toBe(true);
    expect(r.series.length).toBeGreaterThanOrEqual(5);
  });

  it("builds 12 monthly buckets for a year", () => {
    const r = buildReport({
      period: "year",
      range: periodRange("year", "2026-10-15"),
      workouts,
      allActiveDates: [],
      plannedCount: null,
      timezone: "Asia/Kolkata",
      today: "2026-10-18",
    });
    expect(r.series).toHaveLength(12);
    expect(r.series[9].workouts).toBe(4);
  });
});

describe("motivation", () => {
  const base = {
    totalWorkouts: 5,
    workedOutToday: false,
    streak: { current: 3, atRisk: false },
    restRecommended: false,
    weekActiveDays: 1,
    weeklyGoalDays: 3,
    nextSessionTitle: null,
  };
  it("prioritises rest over pushing for more", () => {
    expect(motivationalMessage({ ...base, restRecommended: true })).toMatch(/rest day/);
  });
  it("nudges when the streak is at risk", () => {
    expect(motivationalMessage({ ...base, streak: { current: 4, atRisk: true } })).toMatch(/4-day habit/);
  });
});

import { compactBlocks } from "@/features/workouts/components/session-blocks";

describe("session block display", () => {
  it("collapses repeated run/walk intervals", () => {
    const b = (kind: "run" | "walk" | "warm_up", s: number) => ({
      kind,
      durationSeconds: s,
      sets: null,
      reps: null,
      repeat: 1,
      notes: null,
    });
    const blocks = [
      b("warm_up", 300),
      ...Array.from({ length: 8 }, () => [b("run", 60), b("walk", 90)]).flat(),
      b("warm_up", 300),
    ];
    const groups = compactBlocks(blocks);
    expect(groups.map((g) => [g.blocks.length, g.times])).toEqual([
      [1, 1],
      [2, 8],
      [1, 1],
    ]);
  });
});
