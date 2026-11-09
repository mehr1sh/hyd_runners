import { describe, expect, it } from "vitest";
import { addDays } from "@/features/gamification/logic/time";
import { muscleLoad, shade } from "@/features/recovery/logic/muscles";
import { consecutiveActiveDays, readiness, type DayLoad, type Entry } from "@/features/recovery/logic/readiness";
import { RETURN_WEEKS, returnDays, sessionMinutes, weeksFor } from "@/features/recovery/logic/return-to-run";

const today = "2026-11-09";
const day = (n: number, run = 40, strength = 0): DayLoad => ({
  date: addDays(today, -n),
  runMinutes: run,
  strengthMinutes: strength,
});
const entry = (n: number, e: Partial<Entry>): Entry => ({
  date: addDays(today, -n),
  sleepQuality: null,
  sleepHours: null,
  fatigue: null,
  soreness: null,
  stress: null,
  energy: null,
  workoutRpe: null,
  ...e,
});
// Steady base: three 40-minute runs a week for four weeks.
const steady = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26].map((n) => day(n));

describe("readiness", () => {
  it("labels every signal with its source and never produces a score", () => {
    const r = readiness(steady, [entry(0, { fatigue: 2, sleepQuality: 4 })], today);
    expect(r.signals.find((s) => s.key === "minutes7")?.source).toBe("measured");
    expect(r.signals.find((s) => s.key === "fatigue")?.source).toBe("self_reported");
    expect(r.signals.find((s) => s.key === "load_change")?.source).toBe("estimated");
    expect(JSON.stringify(r)).not.toMatch(/score/i);
    expect(r.suggestion.kind).toBe("strength");
  });

  it("suggests rest for high fatigue or soreness and says why", () => {
    const r = readiness(steady, [entry(0, { soreness: 4 })], today);
    expect(r.suggestion.kind).toBe("rest");
    expect(r.suggestion.because).toEqual(["You rated soreness 4 of 5."]);
    expect(r.suggestion.detail).toMatch(/physiotherapist/);
  });

  it("reduces intensity after poor sleep", () => {
    expect(readiness(steady, [entry(1, { sleepHours: 5 })], today).suggestion.kind).toBe("reduced");
  });

  it("suggests an easy day after a big jump in training time", () => {
    const jump = [...steady.filter((l) => l.date < addDays(today, -6)), day(0, 90), day(2, 90), day(4, 90)];
    const r = readiness(jump, [], today);
    expect(r.suggestion.kind).toBe("easy");
    expect(r.missing[0]).toMatch(/journal entry/);
  });

  it("suggests rest after six days in a row and mobility with no rest day", () => {
    expect(
      readiness(
        [0, 1, 2, 3, 4, 5].map((n) => day(n, 20)),
        [],
        today,
      ).suggestion.kind,
    ).toBe("rest");
    expect(consecutiveActiveDays([day(1), day(2)], today)).toBe(2);
  });

  it("ignores stale journal entries", () => {
    const r = readiness(steady, [entry(3, { fatigue: 5 })], today);
    expect(r.suggestion.kind).not.toBe("rest");
    expect(r.signals.some((s) => s.key === "fatigue")).toBe(false);
  });
});

describe("muscle map", () => {
  it("counts primary muscles fully and secondary muscles by half", () => {
    const load = muscleLoad([[{ key: "glute_bridge", sets: 3 }], [{ key: "calf_raise", sets: 2 }]]);
    expect(load.glutes).toBe(3);
    expect(load.hamstrings).toBe(1.5);
    expect(load.calves).toBe(2);
    expect(load.chest).toBe(0);
  });
  it("ignores exercises it doesn't know rather than guessing", () => {
    const load = muscleLoad([[{ key: "mystery_move", sets: 5 }]]);
    expect(Object.values(load).every((v) => v === 0)).toBe(true);
    expect([0, 2, 6, 12].map(shade)).toEqual([0, 1, 2, 3]);
  });
});

describe("return to running", () => {
  it("builds gradually to continuous running with rest days between sessions", () => {
    for (let i = 1; i < RETURN_WEEKS.length; i++)
      expect(RETURN_WEEKS[i].run).toBeGreaterThanOrEqual(RETURN_WEEKS[i - 1].run);
    expect(RETURN_WEEKS.at(-1)!.walk).toBe(0);
    const [a, b, c] = returnDays(6);
    expect(b - a).toBeGreaterThanOrEqual(2);
    expect(c - b).toBeGreaterThanOrEqual(2);
    expect(sessionMinutes(RETURN_WEEKS[0])).toBe(28);
    expect(weeksFor("regular")[0].week).toBe(3);
  });
});
