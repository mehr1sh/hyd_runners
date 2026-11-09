import { describe, expect, it } from "vitest";
import { detectIntent, mentionedDistance, SUGGESTED_QUESTIONS } from "@/features/hyd-coach/logic/intent";
import { answerQuestion, longestGapDays, windowStats } from "@/features/hyd-coach/logic/compose";
import { checkGrounding, factSheet, ungroundedNumbers } from "@/features/hyd-coach/logic/grounding";
import type { CoachData, RecentRun, WeekRow } from "@/features/hyd-coach/logic/types";
import { addDays, weekStart } from "@/features/gamification/logic/time";
import { predictRaces } from "@/features/training/logic/predict";

const TODAY = "2026-11-09"; // Monday
const NOW = Date.parse("2026-11-09T06:00:00Z");

function run(daysAgo: number, km: number, paceS: number, name: string | null = null): RecentRun {
  const distanceM = km * 1000;
  return {
    id: `a${daysAgo}-${km}`,
    localDate: addDays(TODAY, -daysAgo),
    distanceM,
    movingS: Math.round(km * paceS),
    avgPaceS: paceS,
    name,
  };
}

function weeksFrom(runs: RecentRun[]): WeekRow[] {
  const first = addDays(weekStart(TODAY), -84);
  return Array.from({ length: 13 }, (_, i) => {
    const ws = addDays(first, 7 * i);
    const inWeek = runs.filter((r) => r.localDate >= ws && r.localDate < addDays(ws, 7));
    return {
      weekStart: ws,
      distanceM: inWeek.reduce((s, r) => s + r.distanceM, 0),
      runs: inWeek.length,
      movingS: inWeek.reduce((s, r) => s + r.movingS, 0),
      activeDays: new Set(inWeek.map((r) => r.localDate)).size,
    };
  });
}

function data(runs: RecentRun[], over: Partial<CoachData> = {}): CoachData {
  return {
    today: TODAY,
    nowMs: NOW,
    weeks: weeksFrom(runs),
    runs: [...runs].sort((a, b) => b.localDate.localeCompare(a.localDate)),
    efforts: [],
    plan: { upcoming: [], past28: { planned: 0, completed: 0, missed: 0 } },
    prefs: null,
    conditions: null,
    raceGoal: null,
    recovery: [],
    ...over,
  };
}

// Three runs a week for twelve weeks; the recent six weeks 20 s/km faster.
const steady = Array.from({ length: 84 }, (_, i) => i)
  .filter((d) => d % 7 === 1 || d % 7 === 3 || d % 7 === 5)
  .map((d) => run(d, 6, d < 42 ? 330 : 350));

describe("intent detection", () => {
  it("routes every suggested question somewhere specific", () => {
    for (const q of SUGGESTED_QUESTIONS) expect(detectIntent(q)).not.toBe("overview");
  });
  it.each([
    ["Am I getting faster?", "progress"],
    ["Why did my pace drop this month?", "pace_drop"],
    ["What is my best 5K performance?", "best_effort"],
    ["Have I increased my mileage too quickly?", "mileage_ramp"],
    ["Should I do an easy run or a tempo session today?", "today"],
    ["What should my next four weeks look like?", "next_weeks"],
    ["How am I progressing towards my next race?", "race"],
    ["What did I improve compared with last month?", "month_compare"],
    ["My knee hurts when I run downhill, what is it?", "safety"],
    ["I felt dizzy and had chest tightness", "safety"],
    ["hello", "overview"],
  ])("%s → %s", (q, intent) => {
    expect(detectIntent(q)).toBe(intent);
  });
  it("puts safety ahead of everything else", () => {
    expect(detectIntent("Am I getting faster even though my shin hurts?")).toBe("safety");
  });
  it("reads race distances", () => {
    expect(mentionedDistance("my best 5K")).toBe("5k");
    expect(mentionedDistance("a half marathon")).toBe("half");
    expect(mentionedDistance("10 km race")).toBe("10k");
    expect(mentionedDistance("how am I doing")).toBeNull();
  });
});

describe("window statistics", () => {
  it("needs three paced runs before reporting pace", () => {
    expect(windowStats([run(1, 5, 300), run(2, 5, 300)], addDays(TODAY, -6), TODAY).pace).toBeNull();
    expect(windowStats([run(1, 5, 300), run(2, 5, 300), run(3, 5, 300)], addDays(TODAY, -6), TODAY).pace).toBe(300);
  });
  it("finds the longest gap including the ends", () => {
    expect(longestGapDays([run(5, 5, 300)], addDays(TODAY, -9), TODAY)).toBe(5);
    expect(longestGapDays([], addDays(TODAY, -9), TODAY)).toBe(10);
  });
});

describe("answers", () => {
  it("answers 'getting faster' from the data, citing both periods", () => {
    const a = answerQuestion("Am I getting faster?", data(steady));
    expect(a.intent).toBe("progress");
    expect(a.text).toContain("Yes");
    expect(a.basis.map((f) => f.id)).toEqual(expect.arrayContaining(["pace_6w", "pace_prev_6w"]));
    expect(a.basis.find((f) => f.id === "pace_6w")?.value).toBe("5:30 /km");
    expect(a.uncertainty).toBeTruthy();
    expect(a.dataAsOf).toBe(addDays(TODAY, -1));
  });

  it("says so instead of guessing when there is no data", () => {
    const a = answerQuestion("Am I getting faster?", data([]));
    expect(a.text).toMatch(/No run or walk-run activities/);
    expect(a.missing.length).toBeGreaterThan(0);
    expect(a.basis).toEqual([]);
  });

  it("refuses to compare with too few runs", () => {
    const a = answerQuestion("Am I getting faster?", data([run(1, 5, 300), run(50, 5, 320)]));
    expect(a.text).toMatch(/can't compare/);
    expect(a.uncertainty).toMatch(/Not enough data/);
  });

  it("gives safety guidance and no training data for pain", () => {
    const a = answerQuestion("My knee hurts, should I keep running?", data(steady));
    expect(a.intent).toBe("safety");
    expect(a.text).toMatch(/doctor or physiotherapist/);
    expect(a.text).not.toMatch(/diagnos(e|is) (you|it)/);
    expect(a.basis).toEqual([]);
  });

  it("flags a big weekly jump with a caveat about rules of thumb", () => {
    const base = [7, 14, 21, 28].flatMap((w) => [run(w + 1, 5, 330), run(w + 3, 5, 330)]);
    const a = answerQuestion(
      "Have I increased my mileage too quickly?",
      data([...base, run(2, 10, 330), run(4, 10, 330), run(6, 6, 330)]),
    );
    expect(a.basis.find((f) => f.id === "week_change")?.value).toBe("+160%");
    expect(a.text).toMatch(/big jump/);
    expect(a.uncertainty).toMatch(/rules of thumb/);
  });

  it("lists best efforts with links to the activity", () => {
    const a = answerQuestion(
      "What is my best 5K?",
      data(steady, {
        efforts: [
          { key: "5k", seconds: 1500, activityId: "act-1", startedAt: "2026-10-01T01:00:00.000Z" },
          { key: "10k", seconds: 3200, activityId: "act-2", startedAt: "2026-10-05T01:00:00.000Z" },
        ],
      }),
    );
    expect(a.basis).toHaveLength(1);
    expect(a.basis[0]).toMatchObject({ id: "best_5k", href: "/activities/act-1" });
    expect(a.text).toContain("25:00");
    expect(a.uncertainty).toMatch(/not official race results/);
  });

  it("follows the plan for today when a session is scheduled", () => {
    const a = answerQuestion(
      "Should I run easy or tempo today?",
      data(steady, {
        plan: {
          upcoming: [{ title: "Easy run", workoutType: "run", startsAt: TODAY, durationMinutes: 30 }],
          past28: { planned: 4, completed: 3, missed: 1 },
        },
      }),
    );
    expect(a.recommendation).toMatch(/Follow your plan/);
    expect(a.missing).toContain("Current weather (the forecast could not be loaded).");
  });

  it("recommends rest after three days in a row", () => {
    const a = answerQuestion("What should I do today?", data([run(0, 5, 330), run(1, 5, 330), run(2, 5, 330)]));
    expect(a.recommendation).toMatch(/easy or a rest day/);
  });

  it("builds a four-week outline with an easier last week", () => {
    const a = answerQuestion("What should my next four weeks look like?", data(steady));
    expect(a.text.match(/- Week \d/g)).toHaveLength(4);
    expect(a.text).toMatch(/Week 4.*easier week/);
    expect(a.uncertainty).toMatch(/recommendation/);
  });

  it("every number in an answer is grounded in its facts", () => {
    const d = data(steady, {
      efforts: [{ key: "10k", seconds: 3000, activityId: "x", startedAt: "2026-10-20T01:00:00.000Z" }],
    });
    for (const q of SUGGESTED_QUESTIONS) {
      const a = answerQuestion(q, d);
      const sources = [q, ...a.basis.map((f) => `${f.label} ${f.value}`)];
      // Fixed coaching guidance (minutes, "10%") is allowed text; facts carry the data.
      const stray = ungroundedNumbers(a.text, sources).filter((n) => !["10", "15", "20", "30"].includes(n));
      expect(stray, q).toEqual([]);
    }
  });
});

describe("grounding check for AI phrasing", () => {
  const draft = answerQuestion("Am I getting faster?", data(steady));
  it("accepts a rephrasing that only uses the facts", () => {
    const res = checkGrounding("Am I getting faster?", draft, {
      answer: "Yes. Your recent average pace is 5:30 /km, quicker than 5:50 /km before.",
      usedFactIds: ["pace_6w", "pace_prev_6w"],
      uncertainty: "Average pace is a rough signal.",
    });
    expect(res).toEqual({ ok: true });
  });
  it("rejects invented numbers", () => {
    const res = checkGrounding("Am I getting faster?", draft, {
      answer: "Yes, your heart rate dropped to 142 bpm.",
      usedFactIds: [],
      uncertainty: "",
    });
    expect(res).toEqual({ ok: false, reason: "ungrounded_number" });
  });
  it("rejects unknown fact ids and diagnoses", () => {
    expect(checkGrounding("q", draft, { answer: "Yes.", usedFactIds: ["vo2max"], uncertainty: "" })).toEqual({
      ok: false,
      reason: "unknown_fact",
    });
    expect(
      checkGrounding("q", draft, { answer: "You probably have an injury.", usedFactIds: [], uncertainty: "" }),
    ).toEqual({ ok: false, reason: "unsafe" });
  });
  it("sends only labels and values, never ids of activities", () => {
    const sheet = factSheet(
      "What is my best 5K?",
      answerQuestion(
        "What is my best 5K?",
        data(steady, {
          efforts: [
            { key: "5k", seconds: 1500, activityId: "secret-activity-id", startedAt: "2026-10-01T01:00:00.000Z" },
          ],
        }),
      ),
    );
    expect(sheet).not.toContain("secret-activity-id");
    expect(sheet).toContain("best_5k | Best 5 km | 25:00");
  });
});

describe("race predictions", () => {
  const now = Date.parse("2026-11-09T00:00:00Z");
  it("uses the closest recent effort and gives a range", () => {
    const [five, ten, half, full] = predictRaces(
      [{ key: "10k", seconds: 3000, activityId: "a", startedAt: "2026-10-30T00:00:00Z" }],
      now,
    );
    expect(ten).toMatchObject({ ok: true, seconds: 3000 });
    expect(five.ok && five.seconds).toBe(Math.round(3000 * Math.pow(0.5, 1.06)));
    expect(half.ok && half.low < half.seconds && half.high > half.seconds).toBe(true);
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.limitations.join(" ")).toMatch(/marathon-specific/);
  });
  it("refuses marathon estimates from a 5K and ignores stale or short efforts", () => {
    const preds = predictRaces(
      [
        { key: "5k", seconds: 1500, activityId: "a", startedAt: "2026-10-30T00:00:00Z" },
        { key: "1k", seconds: 240, activityId: "b", startedAt: "2026-10-30T00:00:00Z" },
        { key: "half", seconds: 6000, activityId: "c", startedAt: "2025-01-01T00:00:00Z" },
      ],
      now,
    );
    expect(preds.find((p) => p.race === "marathon")).toMatchObject({ ok: false });
    expect(
      predictRaces([{ key: "1k", seconds: 240, activityId: "b", startedAt: "2026-10-30T00:00:00Z" }], now)[0],
    ).toMatchObject({ ok: false });
  });
});
