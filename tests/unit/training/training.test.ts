import { describe, expect, it } from "vitest";
import { addDays, daysBetween, weekday } from "@/features/gamification/logic/time";
import { adaptiveProposal, inferKind, missedSessionProposal, type Session } from "@/features/training/logic/adapt";
import { heatAdvice } from "@/features/training/logic/heat";
import {
  clock,
  intervalTargets,
  paceFrom,
  parseClock,
  raceSplits,
  trainingPaces,
} from "@/features/training/logic/pace";
import { generateRacePlan, planWeeksAvailable } from "@/features/training/logic/race-plan";
import { EXERCISE_BY_KEY, STRENGTH_SESSIONS } from "@/features/training/logic/strength-templates";
import { generateWorkout, QUALITY_KINDS, WORKOUT_KINDS } from "@/features/training/logic/workouts";

describe("pace arithmetic", () => {
  it("parses and formats clock times", () => {
    expect(parseClock("5:30")).toBe(330);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("45")).toBe(2700);
    expect(parseClock("1:75:00")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(330)).toBe("5:30");
  });
  it("even splits add up to the finish time", () => {
    const s = raceSplits(3300, 10000);
    expect(s).toHaveLength(10);
    expect(s.at(-1)!.elapsedSeconds).toBe(3300);
    expect(new Set(s.map((x) => x.splitSeconds)).size).toBe(1);
  });
  it("negative splits keep the total and make the second half faster", () => {
    const s = raceSplits(3300, 10000, 1000, 4);
    expect(s.at(-1)!.elapsedSeconds).toBe(3300);
    expect(s[9].paceS).toBeLessThan(s[0].paceS);
    const first = s.slice(0, 5).reduce((a, x) => a + x.splitSeconds, 0);
    expect(first).toBeGreaterThan(1650);
  });
  it("handles a partial last split and interval targets", () => {
    const s = raceSplits(paceFrom(6300, 21097.5) * 21.0975, 21097.5);
    expect(s).toHaveLength(22);
    expect(Math.round(s.at(-1)!.meters)).toBe(98);
    expect(intervalTargets(300, [400, 1000])).toEqual([
      { meters: 400, seconds: 120 },
      { meters: 1000, seconds: 300 },
    ]);
  });
  it("derives training paces with easy slower than tempo slower than intervals", () => {
    const p = trainingPaces(1500, "test");
    expect(p.easy[0]).toBeGreaterThan(p.tempo[1]);
    expect(p.tempo[0]).toBeGreaterThan(p.interval[1]);
  });
});

describe("workout generator", () => {
  it("every session has a warm-up, a main set, a cool-down and a duration", () => {
    for (const kind of WORKOUT_KINDS)
      for (const level of ["new_to_running", "returning", "regular"] as const) {
        const w = generateWorkout(kind, { level, minutes: 45, paces: trainingPaces(1500, "test") });
        expect(w.warmup.minutes).toBeGreaterThan(0);
        expect(w.main.length).toBeGreaterThan(0);
        expect(w.cooldown.minutes).toBeGreaterThan(0);
        expect(w.totalMinutes).toBeGreaterThanOrEqual(15);
        expect(w.intensity).toBeTruthy();
      }
  });
  it("scales intensity to the level", () => {
    const beginner = generateWorkout("intervals", { level: "new_to_running", minutes: 40 });
    const regular = generateWorkout("intervals", { level: "regular", minutes: 40, paces: trainingPaces(1500, "test") });
    expect(beginner.main[0].meters).toBeUndefined();
    expect(beginner.main[0].recovery).toMatch(/walk/);
    expect(regular.main[0].meters).toBe(800);
    expect(regular.main[0].pace).toMatch(/\/km/);
  });
  it("falls back to effort when there is no reference pace", () => {
    const w = generateWorkout("tempo", { level: "regular", minutes: 45, paces: null });
    expect(w.main[0].pace).toBeUndefined();
    expect(w.notes.join(" ")).toMatch(/effort levels/);
  });
});

describe("race plan", () => {
  const base = {
    distance: "half" as const,
    raceDate: "2027-02-21",
    today: "2026-11-09",
    level: "returning" as const,
    daysPerWeek: 4,
    longRunDay: 7,
    recentWeeklyKm: 18,
    paces: trainingPaces(1650, "test"),
  };
  const plan = generateRacePlan(base);

  it("has phases ending in a taper and the race", () => {
    expect(plan.weeks).toHaveLength(12);
    expect(plan.weeks.at(-1)!.phase).toBe("race");
    expect(plan.weeks.at(-2)!.phase).toBe("taper");
    expect(plan.weeks[0].phase).toBe("base");
    const raceSession = plan.weeks.at(-1)!.sessions.find((s) => s.kind === "race");
    expect(raceSession?.date).toBe("2027-02-21");
  });

  it("never grows weekly distance by more than about 10% and has easier weeks", () => {
    const kms = plan.weeks.slice(0, -3).map((w) => w.targetKm);
    // Against the biggest week so far: returning after an easier week is not growth.
    for (let i = 1; i < kms.length; i++) expect(kms[i] / Math.max(...kms.slice(0, i))).toBeLessThanOrEqual(1.12);
    expect(kms.some((k, i) => i > 0 && k < kms[i - 1])).toBe(true);
  });

  it("keeps quality sessions two or more days from the long run and each other", () => {
    for (const w of plan.weeks) {
      const hard = w.sessions.filter((s) => s.kind === "long" || (QUALITY_KINDS as readonly string[]).includes(s.kind));
      for (let i = 0; i < hard.length; i++)
        for (let j = i + 1; j < hard.length; j++)
          expect(Math.abs(daysBetween(hard[i].date, hard[j].date))).toBeGreaterThanOrEqual(2);
    }
  });

  it("puts long runs on the chosen day and keeps every session between today and race day", () => {
    for (const w of plan.weeks)
      for (const s of w.sessions) {
        expect(s.date >= base.today && s.date <= base.raceDate).toBe(true);
        if (s.kind === "long") expect(weekday(s.date)).toBe(7);
      }
  });

  it("includes strength sessions with catalogued exercises", () => {
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "strength");
    expect(strength.length).toBeGreaterThan(0);
    for (const key of Object.keys(STRENGTH_SESSIONS) as (keyof typeof STRENGTH_SESSIONS)[])
      for (const ex of STRENGTH_SESSIONS[key].exercises) expect(EXERCISE_BY_KEY.has(ex), ex).toBe(true);
  });

  it("gives beginners no hard sessions in base weeks", () => {
    const p = generateRacePlan({
      ...base,
      distance: "5k",
      raceDate: "2027-01-03",
      level: "new_to_running",
      recentWeeklyKm: 0,
    });
    for (const w of p.weeks.filter((x) => x.phase === "base"))
      expect(w.sessions.some((s) => (QUALITY_KINDS as readonly string[]).includes(s.kind))).toBe(false);
    expect(p.weeks.flatMap((w) => w.sessions).every((s) => s.workoutType !== "run")).toBe(true);
  });

  it("warns about short timelines and low-volume marathons", () => {
    const p = generateRacePlan({ ...base, distance: "marathon", raceDate: "2026-12-20", recentWeeklyKm: 10 });
    expect(p.warnings.join(" ")).toMatch(/Only \d+ weeks/);
    expect(p.warnings.join(" ")).toMatch(/under 20 km a week/);
  });

  it("counts available weeks from next Monday", () => {
    expect(planWeeksAvailable("2026-11-09", "2026-11-15")).toBe(1);
    expect(planWeeksAvailable("2026-11-10", "2026-11-22")).toBe(1);
    expect(planWeeksAvailable("2026-11-10", "2026-11-29")).toBe(2);
  });
});

describe("missed-session recovery", () => {
  const today = "2026-11-11"; // Wednesday
  const s = (id: string, date: string, title: string, minutes = 40, workoutType = "run"): Session => ({
    id,
    date,
    title,
    workoutType,
    minutes,
    startTime: "06:00",
    kind: inferKind(title, workoutType),
  });

  it("lets an easy session go without adding work", () => {
    const p = missedSessionProposal(s("m", "2026-11-10", "Easy run"), [], today);
    expect(p.changes).toEqual([expect.objectContaining({ op: "mark_missed", workout_id: "m" })]);
  });

  it("moves a long run to a free day away from other hard sessions, slightly shorter", () => {
    const upcoming = [
      s("t", "2026-11-12", "Tempo run"),
      s("e", "2026-11-15", "Easy run"),
      s("l2", "2026-11-22", "Long run", 90),
    ];
    const p = missedSessionProposal(s("m", "2026-11-09", "Long run", 90), upcoming, today);
    const add = p.changes.find((c) => c.op === "add");
    expect(add).toMatchObject({ date: "2026-11-14", duration_minutes: 72 });
    expect(p.changes[0]).toMatchObject({ op: "mark_missed" });
  });

  it("swaps a quality session into an easy day instead of adding one", () => {
    const upcoming = [s("e1", "2026-11-12", "Easy run", 35), s("l", "2026-11-15", "Long run", 80)];
    const p = missedSessionProposal(s("m", "2026-11-10", "Tempo run", 45), upcoming, today);
    expect(p.changes.map((c) => c.op)).toEqual(["mark_missed", "cancel", "add"]);
    expect(p.changes[1]).toMatchObject({ workout_id: "e1" });
  });

  it("lets it go when no safe slot exists or the race is near", () => {
    const busy = [s("t", "2026-11-12", "Intervals"), s("l", "2026-11-14", "Long run", 80)];
    expect(missedSessionProposal(s("m", "2026-11-10", "Tempo run"), busy, today).changes).toHaveLength(1);
    const race = [s("r", "2026-11-15", "Race: Hyderabad 10K")];
    expect(missedSessionProposal(s("m", "2026-11-10", "Long run", 80), race, today).summary).toMatch(/race/);
  });

  it("never adds a session on a day that already has one", () => {
    const upcoming = [11, 12, 13, 14].map((d) => s(`e${d}`, `2026-11-${d}`, "Strength", 25, "strength"));
    const p = missedSessionProposal(s("m", "2026-11-10", "Long run", 80), upcoming, today);
    expect(p.changes.some((c) => c.op === "add")).toBe(false);
  });
});

describe("adaptive adjustment", () => {
  const upcoming: Session[] = [
    {
      id: "q",
      date: "2026-11-12",
      title: "Intervals",
      workoutType: "run",
      minutes: 50,
      startTime: "06:00",
      kind: "intervals",
    },
    {
      id: "l",
      date: "2026-11-15",
      title: "Long run",
      workoutType: "run",
      minutes: 90,
      startTime: "06:00",
      kind: "long",
    },
    {
      id: "e",
      date: "2026-11-13",
      title: "Easy run",
      workoutType: "run",
      minutes: 30,
      startTime: "06:00",
      kind: "easy",
    },
  ];
  it("continues as planned when training went well", () => {
    expect(
      adaptiveProposal({ past14: { planned: 8, completed: 7, missed: 1 }, upcoming7: upcoming, fatigue: 2 }),
    ).toBeNull();
  });
  it("eases off after poor adherence, without adding load", () => {
    const p = adaptiveProposal({
      past14: { planned: 8, completed: 3, missed: 5 },
      upcoming7: upcoming,
      fatigue: null,
    })!;
    expect(p.reasons[0]).toMatch(/3 of 8/);
    expect(p.changes.find((c) => c.op === "shorten")).toMatchObject({ workout_id: "l", duration_minutes: 72 });
    expect(p.changes.find((c) => c.op === "cancel")).toMatchObject({ workout_id: "q" });
    const added = p.changes.filter((c) => c.op === "add");
    expect(added.every((c) => c.op === "add" && c.duration_minutes <= 50)).toBe(true);
  });
  it("responds to high reported fatigue", () => {
    const p = adaptiveProposal({ past14: { planned: 8, completed: 8, missed: 0 }, upcoming7: upcoming, fatigue: 4.2 });
    expect(p?.reasons[0]).toMatch(/fatigue/);
  });
});

describe("heat guidance", () => {
  it("bands by feels-like temperature and humidity", () => {
    expect(heatAdvice(22, 50, 40, "easy").band).toBe("none");
    expect(heatAdvice(26, 50, 40, "easy").band).toBe("warm");
    expect(heatAdvice(26, 85, 40, "easy").band).toBe("hot");
    expect(heatAdvice(34, 50, 40, "quality").advice.join(" ")).toMatch(/Swap the hard session/);
    expect(heatAdvice(38, 40, 40, "easy")).toMatchObject({ band: "extreme", slowdownPct: null });
    expect(heatAdvice(30, 40, 90, "long").advice.join(" ")).toMatch(/water/);
  });
});

describe("dates", () => {
  it("weekday helper agrees with the plan", () => {
    expect(weekday(addDays("2026-11-09", 6))).toBe(7);
  });
});
