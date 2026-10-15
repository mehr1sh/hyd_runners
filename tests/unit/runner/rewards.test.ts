import { describe, expect, it } from "vitest";
import { computeRewards, RULES, workoutXp } from "@/features/gamification/logic/rewards";
import { characterStage } from "@/features/gamification/logic/character";
import { levelForXp, levelProgress, xpThreshold } from "@/features/gamification/logic/levels";
import type { RewardHistory, WorkoutFact } from "@/features/gamification/logic/types";
import { addDays } from "@/features/gamification/logic/time";
import { workout } from "./helpers";

const history = (workouts: WorkoutFact[], extra: Partial<RewardHistory> = {}): RewardHistory => ({
  timezone: "Asia/Kolkata",
  workouts,
  enrollments: [],
  firstRsvpAt: null,
  ...extra,
});
const keys = (h: RewardHistory) => computeRewards(h).awards.map((a) => a.awardKey);

describe("workout XP", () => {
  it("is 20 base + 1 per 5 minutes, capped at +12", () => {
    expect(workoutXp(10 * 60)).toBe(22);
    expect(workoutXp(30 * 60)).toBe(26);
    expect(workoutXp(180 * 60)).toBe(32);
  });

  it("pays the first workout of a day once, with a first-workout badge", () => {
    const out = computeRewards(history([workout("2026-10-12T06:30:00", 30)]));
    const xp = out.awards.reduce((s, a) => s + a.deltaXp, 0);
    expect(out.awards.map((a) => a.awardKey)).toEqual([
      "workout:day:2026-10-12",
      "badge:first-workout",
      "badge:early-bird",
    ]);
    expect(xp).toBe(26 + 20 + 15);
  });

  it("does not pay a second workout on the same local day", () => {
    const k = keys(history([workout("2026-10-12T07:00:00"), workout("2026-10-12T19:00:00")]));
    expect(k.filter((x) => x.startsWith("workout:day:"))).toEqual(["workout:day:2026-10-12"]);
  });

  it("does not count workouts under 10 minutes towards XP or streaks", () => {
    const out = computeRewards(history([workout("2026-10-12T07:00:00", 5)]));
    expect(out.awards.some((a) => a.reason === "workout_completed")).toBe(false);
    expect(out.badges.map((b) => b.code)).toContain("first-workout");
  });
});

describe("idempotency", () => {
  it("produces identical award keys when the same history is recomputed", () => {
    const ws = [workout("2026-10-12T07:00:00"), workout("2026-10-14T07:00:00"), workout("2026-10-16T07:00:00")];
    expect(keys(history(ws))).toEqual(keys(history([...ws].reverse())));
  });

  it("has unique award keys, so ON CONFLICT DO NOTHING blocks double payment", () => {
    const ws = Array.from({ length: 20 }, (_, i) => workout(`2026-09-${String(i + 1).padStart(2, "0")}T18:00:00`));
    const k = keys(history(ws));
    expect(new Set(k).size).toBe(k.length);
  });

  it("does not re-pay a streak milestone when a backdated workout moves the streak start", () => {
    const later = [workout("2026-10-12T07:00:00"), workout("2026-10-14T07:00:00")];
    const first = keys(history(later));
    expect(first).toContain("streak:daily:3:2026-10-12");
    const withBackdate = keys(history([workout("2026-10-10T07:00:00"), ...later], { existingAwardKeys: first }));
    expect(withBackdate.filter((k) => k.startsWith("streak:daily:3:"))).toEqual([]);
  });
});

describe("recovery guard", () => {
  it("withholds workout XP on the 7th consecutive day", () => {
    const ws = Array.from({ length: 7 }, (_, i) => workout(`${addDays("2026-10-01", i)}T18:00:00`));
    const out = computeRewards(history(ws));
    expect(out.awards.filter((a) => a.reason === "workout_completed")).toHaveLength(RULES.maxRewardedDaysPerWeekWindow);
    expect(out.recoveryCappedDays).toEqual(["2026-10-07"]);
  });
});

describe("plan bonus and programmes", () => {
  const sessions = [1, 2, 3].map((d) => ({ id: `s1-${d}`, week: 1 }));
  const enrollments = [{ enrollmentId: "e1", programmeSlug: "couch-to-5k", sessions }];

  it("pays one plan bonus per day and earns the C25K week-1 badge", () => {
    const ws = [
      workout("2026-10-12T18:00:00", 30, { programmeSessionId: "s1-1", enrollmentId: "e1" }),
      workout("2026-10-14T18:00:00", 30, { programmeSessionId: "s1-2", enrollmentId: "e1" }),
      workout("2026-10-16T18:00:00", 30, { programmeSessionId: "s1-3", enrollmentId: "e1" }),
    ];
    const out = computeRewards(history(ws, { enrollments }));
    expect(out.awards.filter((a) => a.reason === "planned_workout_on_time")).toHaveLength(3);
    expect(out.badges.map((b) => b.code)).toEqual(
      expect.arrayContaining(["c25k-week-1", "programme-complete", "c25k-graduate"]),
    );
    expect(out.completedEnrollments).toEqual([{ enrollmentId: "e1", completedAt: ws[2].completedAt }]);
  });

  it("gives no second plan bonus for doubling up sessions on one day", () => {
    const ws = [
      workout("2026-10-12T07:00:00", 30, { programmeSessionId: "s1-1", enrollmentId: "e1" }),
      workout("2026-10-12T18:00:00", 30, { programmeSessionId: "s1-2", enrollmentId: "e1" }),
    ];
    const out = computeRewards(history(ws, { enrollments }));
    expect(out.awards.filter((a) => a.reason === "planned_workout_on_time")).toHaveLength(1);
  });

  it("only pays the planned-workout bonus on the planned day", () => {
    const onTime = workout("2026-10-12T18:00:00", 30, { plannedWorkoutId: "p1", plannedDate: "2026-10-12" });
    const late = workout("2026-10-14T18:00:00", 30, { plannedWorkoutId: "p2", plannedDate: "2026-10-13" });
    const k = keys(history([onTime, late]));
    expect(k).toContain("plan:planned:p1");
    expect(k).not.toContain("plan:planned:p2");
  });
});

describe("challenges and badges", () => {
  it("records each weekly challenge once per week", () => {
    const ws = [
      workout("2026-10-12T18:00:00", 25),
      workout("2026-10-14T18:00:00", 25, { workoutType: "mobility" }),
      workout("2026-10-16T18:00:00", 25),
    ];
    const out = computeRewards(history(ws));
    const codes = out.challenges.map((c) => c.code).sort();
    expect(codes).toEqual(["mix-it-up", "sixty-minutes", "three-day-week"]);
    expect(out.challenges.every((c) => c.weekStart === "2026-10-12")).toBe(true);
    expect(out.badges.map((b) => b.code)).toContain("challenges-3");
  });

  it("awards distance badges from run and walk-run distance only", () => {
    const ws = [
      workout("2026-10-12T18:00:00", 30, { distanceMeters: 3000 }),
      workout("2026-10-14T18:00:00", 30, { workoutType: "walk", distanceMeters: 5000 }),
      workout("2026-10-16T18:00:00", 30, { workoutType: "walk_run", distanceMeters: 2000 }),
    ];
    const out = computeRewards(history(ws));
    expect(out.badges.find((b) => b.code === "distance-5k")?.earnedAt).toBe(ws[2].completedAt);
  });
});

describe("levels and character", () => {
  it("uses a 50·n·(n−1) curve", () => {
    expect([1, 2, 3, 4, 5].map(xpThreshold)).toEqual([0, 100, 300, 600, 1000]);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelProgress(350)).toMatchObject({ level: 3, xpIntoLevel: 50, xpForNextLevel: 300, rank: "Regular" });
  });

  it("evolves only through earned milestones, in order", () => {
    expect(characterStage([]).stage).toBe(1);
    expect(characterStage(["first-workout"]).stage).toBe(2);
    expect(characterStage(["first-workout", "workouts-5"]).stage).toBe(2);
    expect(characterStage(["first-workout", "workouts-5", "streak-7"]).stage).toBe(3);
    // Stage 4 is not reachable by skipping stage 3.
    expect(characterStage(["first-workout", "c25k-halfway"]).stage).toBe(2);
  });
});
