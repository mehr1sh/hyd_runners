// @vitest-environment node
/**
 * Evaluation harness for the schedule planner. Assertions keep
 * the measured guarantees from regressing; `EVAL_REPORT=1` prints the numbers:
 *
 *   EVAL_REPORT=1 pnpm exec vitest run tests/unit/scheduler/evaluation.test.ts
 *
 * Scheduling results are checked by an independent checker written here, not
 * by the app's `validateSchedule`, so a shared bug cannot hide itself.
 */
import { describe, expect, it } from "vitest";
import { AiProviderError, type AiFailureKind, type StructuredGenerator } from "@/lib/ai/structured";
import {
  parseTimetableText,
  planWeek,
  RECOVERY_RULES,
  isHard,
  toMinutes,
  type PlannerSettings,
} from "@/features/scheduler/logic";
import { processTimetable } from "@/features/scheduler/server/extraction";
import { extractPdfText } from "@/features/scheduler/server/pdf-text";
import { generateProposal } from "@/features/scheduler/server/planner";
import { makeKey } from "./fixtures";
import { buildPdf } from "./pdf-fixture";

const report = (label: string, data: unknown) => {
  if (process.env.EVAL_REPORT === "1") console.info(`\n[eval] ${label}\n${JSON.stringify(data, null, 2)}`);
};

// ---------------------------------------------------------------------------
// 1. Availability parsing on a labelled corpus
// ---------------------------------------------------------------------------

type Row = [weekday: number, start: string, end: string];
type Case = { name: string; text: string; expected: Row[] } | { name: string; text: string; ambiguous: true };

const CORPUS: Case[] = [
  {
    name: "24h one line per class",
    text: "Monday 09:00-10:30 Physics\nTuesday 11:00-12:00 Chem",
    expected: [
      [1, "09:00", "10:30"],
      [2, "11:00", "12:00"],
    ],
  },
  {
    name: "12h with AM/PM",
    text: "Wed 9:30 AM - 11:00 AM Lecture\nWed 2:00 PM - 4:00 PM Lab",
    expected: [
      [3, "09:30", "11:00"],
      [3, "14:00", "16:00"],
    ],
  },
  {
    name: "shared meridiem",
    text: "Thu 2-3pm Tutorial\nFri 11-1pm Workshop",
    expected: [
      [4, "14:00", "15:00"],
      [5, "11:00", "13:00"],
    ],
  },
  {
    name: "day headings",
    text: "MONDAY\n08:00-09:00 English\n10:00-11:00 Maths\nTUESDAY\n08:00-09:30 Biology",
    expected: [
      [1, "08:00", "09:00"],
      [1, "10:00", "11:00"],
      [2, "08:00", "09:30"],
    ],
  },
  {
    name: "day range",
    text: "Mon-Fri 17:00-18:00 Part-time job",
    expected: [1, 2, 3, 4, 5].map((d) => [d, "17:00", "18:00"] as Row),
  },
  {
    name: "day list and 'to'",
    text: "Mon, Wed 13:00 to 14:00 Seminar",
    expected: [
      [1, "13:00", "14:00"],
      [3, "13:00", "14:00"],
    ],
  },
  { name: "dotted times", text: "Saturday 10.00-12.00 Football", expected: [[6, "10:00", "12:00"]] },
  { name: "en dash and labels", text: "Sunday 07:30–08:30 Choir practice", expected: [[7, "07:30", "08:30"]] },
  {
    name: "header and footer noise",
    text: "IIIT Hyderabad · Semester timetable\nTuesday 15:00-16:30 Design\nPage 1 of 1",
    expected: [[2, "15:00", "16:30"]],
  },
  {
    name: "abbreviated days",
    text: "Tues 14:00-15:00 Lab\nThurs 14:00-15:00 Lab",
    expected: [
      [2, "14:00", "15:00"],
      [4, "14:00", "15:00"],
    ],
  },
  { name: "ambiguous hours", text: "Monday 2-4 Tutorial", ambiguous: true },
  { name: "no day", text: "10:00-11:00 Physics", ambiguous: true },
  { name: "grid layout", text: "Mon Tue Wed Thu Fri\n09:00-10:00 Phy Chem Maths Bio Eng", ambiguous: true },
  { name: "missing end time", text: "Wednesday 10:30 Meeting", ambiguous: true },
  { name: "one-off date", text: "Fri 12/11/2026 10:00-12:00 Exam", ambiguous: true },
  { name: "8–12 without AM/PM in a 12h document", text: "Sat 8-10 Football", ambiguous: true },
];

describe("evaluation: availability parsing", () => {
  it("never presents a wrong value as certain, and flags every ambiguous input", () => {
    const outcomes = CORPUS.map((c) => {
      const r = parseTimetableText(c.text, makeKey);
      if ("ambiguous" in c) {
        const flagged = r.status !== "complete" && r.drafts.some((d) => d.uncertainties.length > 0);
        return { name: c.name, kind: "ambiguous", success: flagged, wrong: !flagged };
      }
      const got = r.drafts.map((d) => [d.weekday, d.startTime, d.endTime]);
      const exact = r.status === "complete" && JSON.stringify(got) === JSON.stringify(c.expected);
      // Wrong = a row presented as certain whose values are not in the expected set.
      const wrong = r.drafts.some(
        (d) =>
          d.uncertainties.length === 0 &&
          !c.expected.some((e) => JSON.stringify(e) === JSON.stringify([d.weekday, d.startTime, d.endTime])),
      );
      return { name: c.name, kind: "clear", success: exact, wrong };
    });
    const clear = outcomes.filter((o) => o.kind === "clear");
    const ambiguous = outcomes.filter((o) => o.kind === "ambiguous");
    report("availability parsing", {
      clearInputs: clear.length,
      clearParsedExactly: clear.filter((o) => o.success).length,
      clearFlaggedForReviewInstead: clear.filter((o) => !o.success && !o.wrong).length,
      silentlyWrong: outcomes.filter((o) => o.wrong).length,
      ambiguousInputs: ambiguous.length,
      ambiguousFlagged: ambiguous.filter((o) => o.success).length,
      failures: outcomes.filter((o) => !o.success).map((o) => o.name),
    });
    expect(outcomes.filter((o) => o.wrong)).toEqual([]);
    expect(ambiguous.every((o) => o.success)).toBe(true);
    // Measured baseline on 2026-10-14: 9 of 10 clear inputs exact ("10.00-12.00" is flagged, by design).
    expect(clear.filter((o) => o.success).length).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// 2. Scheduling on seeded random scenarios
// ---------------------------------------------------------------------------

/** Mulberry32: small seeded PRNG so scenarios are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function scenario(seed: number) {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const availability: Array<{ weekday: number; startTime: string; endTime: string; kind: "free" | "busy" }> = [];
  for (let d = 1; d <= 7; d++) {
    const windows = Math.floor(r() * 3);
    for (let w = 0; w < windows; w++) {
      const start = (5 + Math.floor(r() * 16)) * 60 + pick([0, 15, 30, 45]);
      const end = Math.min(start + pick([10, 15, 20, 25, 30, 45, 60, 90, 120]), 23 * 60 + 59);
      // Overlapping free rows are rejected when availability is saved, so they never reach the scheduler.
      const overlaps = availability.some(
        (x) => x.weekday === d && x.kind === "free" && start < toMinutes(x.endTime) && end > toMinutes(x.startTime),
      );
      if (!overlaps) availability.push({ weekday: d, startTime: hhmm(start), endTime: hhmm(end), kind: "free" });
    }
    if (r() < 0.5) {
      const start = (6 + Math.floor(r() * 14)) * 60;
      availability.push({
        weekday: d,
        startTime: hhmm(start),
        endTime: hhmm(start + pick([30, 60, 180])),
        kind: "busy",
      });
    }
  }
  const settings: PlannerSettings = {
    goal: pick(["build_habit", "first_5k", "run_without_stopping", "get_stronger", "return_after_break"] as const),
    fitnessLevel: pick(["new_to_running", "returning", "regular"] as const),
    sessionsPerWeek: 1 + Math.floor(r() * 7),
    maxSessionMinutes: pick([15, 20, 25, 30, 45, 60, 90]),
    preferredDays: [1, 2, 3, 4, 5, 6, 7].filter(() => r() < 0.3),
    preferredTimesOfDay: (["early_morning", "morning", "afternoon", "evening", "night"] as const).filter(
      () => r() < 0.25,
    ),
    programmeWeek: 1 + Math.floor(r() * 10),
  };
  return { availability, settings };
}

/** Independent hard-constraint checker (does not use app validation code). */
function independentCheck(
  sessions: ReturnType<typeof planWeek>["proposal"]["sessions"],
  { availability, settings }: ReturnType<typeof scenario>,
) {
  const problems: string[] = [];
  let conflicts = 0;
  const rules = RECOVERY_RULES[settings.fitnessLevel];
  // Touching free rows (e.g. 20:00–20:15 and 20:15–22:15) form one continuous period.
  const freeSpans = (weekday: number) => {
    const spans = availability
      .filter((x) => x.kind === "free" && x.weekday === weekday)
      .map((x) => [toMinutes(x.startTime), toMinutes(x.endTime)])
      .sort((x, y) => x[0] - y[0]);
    const merged: number[][] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    return merged;
  };
  for (const s of sessions) {
    const a = toMinutes(s.startTime);
    const b = a + s.durationMinutes;
    const inFree = freeSpans(s.weekday).some(([from, to]) => a >= from && b <= to);
    const hitsBusy = availability.some(
      (x) => x.kind === "busy" && x.weekday === s.weekday && a < toMinutes(x.endTime) && b > toMinutes(x.startTime),
    );
    if (!inFree) problems.push("outside free time");
    if (hitsBusy) problems.push("in busy time");
    if (b > 24 * 60) problems.push("crosses midnight");
    if (s.durationMinutes < 10 || s.durationMinutes > settings.maxSessionMinutes) problems.push("duration");
  }
  for (let i = 0; i < sessions.length; i++)
    for (let j = i + 1; j < sessions.length; j++) if (sessions[i].weekday === sessions[j].weekday) conflicts++;
  if (sessions.length > Math.min(settings.sessionsPerWeek, rules.maxSessionsPerWeek)) problems.push("too many");
  if (7 - new Set(sessions.map((s) => s.weekday)).size < rules.minRestDays && sessions.length > 0)
    problems.push("rest days");
  const hardDays = sessions
    .filter((s) => isHard(s.workoutType))
    .map((s) => s.weekday)
    .sort((x, y) => x - y);
  let run = 1;
  for (let i = 1; i < hardDays.length; i++) {
    run = hardDays[i] === hardDays[i - 1] + 1 ? run + 1 : 1;
    if (run > rules.maxConsecutiveHardDays) problems.push("consecutive hard days");
  }
  return { problems, conflicts };
}

const SCENARIOS = 1000;

describe("evaluation: scheduling", () => {
  it(`produces only valid schedules across ${SCENARIOS} seeded scenarios`, () => {
    let valid = 0;
    let conflicts = 0;
    let violatingSchedules = 0;
    let requested = 0;
    let placed = 0;
    let withUnplaced = 0;
    let unexplained = 0;
    const latencies: number[] = [];
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const sc = scenario(seed);
      const t0 = performance.now();
      const out = planWeek({ weekStart: "2026-10-19", timezone: "Asia/Kolkata", ...sc });
      latencies.push(performance.now() - t0);
      const check = independentCheck(out.proposal.sessions, sc);
      if (out.violations.length === 0 && check.problems.length === 0 && check.conflicts === 0) valid++;
      if (check.problems.length > 0) violatingSchedules++;
      conflicts += check.conflicts;
      requested += sc.settings.sessionsPerWeek;
      placed += out.proposal.sessions.length;
      if (out.proposal.sessions.length < sc.settings.sessionsPerWeek) {
        withUnplaced++;
        const explained = out.proposal.warnings.length > 0 || out.proposal.unsatisfied.length > 0;
        if (!explained) unexplained++;
      }
      if (out.proposal.sessions.some((s) => s.rationale.length === 0)) unexplained++;
    }
    latencies.sort((a, b) => a - b);
    const pct = (p: number) =>
      Number(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))].toFixed(2));
    report("scheduling", {
      scenarios: SCENARIOS,
      validSchedules: valid,
      validRate: valid / SCENARIOS,
      overlappingOrSameDaySessionPairs: conflicts,
      schedulesViolatingHardConstraints: violatingSchedules,
      sessionsRequested: requested,
      sessionsPlaced: placed,
      scenariosWithFewerSessionsThanRequested: withUnplaced,
      shortfallsOrSessionsWithoutExplanation: unexplained,
      latencyMs: { p50: pct(0.5), p95: pct(0.95), max: Number(latencies.at(-1)!.toFixed(2)) },
    });
    expect(valid).toBe(SCENARIOS);
    expect(conflicts).toBe(0);
    expect(violatingSchedules).toBe(0);
    expect(unexplained).toBe(0);
  });

  it("is deterministic: identical input gives identical output", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const sc = scenario(seed);
      const a = planWeek({ weekStart: "2026-10-19", timezone: "Asia/Kolkata", ...sc });
      const b = planWeek({ weekStart: "2026-10-19", timezone: "Asia/Kolkata", ...sc });
      expect(b).toEqual(a);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. AI failure detection and fallback
// ---------------------------------------------------------------------------

describe("evaluation: AI failure and fallback", () => {
  it("detects every failure kind and always returns a valid deterministic plan", async () => {
    const kinds: AiFailureKind[] = [
      "timeout",
      "auth",
      "rate_limited",
      "server",
      "network",
      "blocked",
      "malformed",
      "invalid_output",
    ];
    const rows: Array<{ kind: string; detected: boolean; fellBack: boolean; valid: boolean; calls: number }> = [];
    for (const [i, kind] of kinds.entries()) {
      const sc = scenario(100 + i);
      let calls = 0;
      const generator: StructuredGenerator = {
        async generateStructured() {
          calls++;
          throw new AiProviderError(kind, "simulated");
        },
      };
      const { result, ai } = await generateProposal({
        weekStart: "2026-10-19",
        timezone: "Asia/Kolkata",
        ...sc,
        generator,
      });
      const check = independentCheck(result.proposal.sessions, sc);
      rows.push({
        kind,
        detected: ai.status === "failed" || (ai.status === "not_requested" && result.proposal.sessions.length === 0),
        fellBack: result.proposal.source === "deterministic",
        valid: check.problems.length === 0 && check.conflicts === 0,
        calls,
      });
    }
    report("AI fallback", rows);
    for (const row of rows) {
      expect(row).toMatchObject({ detected: true, fellBack: true, valid: true });
      expect(row.calls).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Timetable processing latency (text PDFs, no AI)
// ---------------------------------------------------------------------------

describe("evaluation: processing latency", () => {
  it("reads one-page text PDFs (5, 20 and 60 rows) through the full pipeline", async () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const results: Record<string, { runs: number; p50: number; max: number }> = {};
    for (const rows of [5, 20, 60]) {
      const lines = Array.from(
        { length: rows },
        (_, i) =>
          `${days[i % 6]} ${String(7 + (i % 12)).padStart(2, "0")}:00-${String(8 + (i % 12)).padStart(2, "0")}:00 Class ${i}`,
      );
      const pdf = buildPdf(lines);
      const times: number[] = [];
      for (let run = 0; run < 20; run++) {
        const t0 = performance.now();
        const r = await processTimetable({
          bytes: pdf,
          mimeType: "application/pdf",
          extractPdfText,
          aiExtract: null,
          makeKey,
        });
        times.push(performance.now() - t0);
        expect(r.ok).toBe(true);
      }
      times.sort((a, b) => a - b);
      results[`${rows} rows`] = {
        runs: times.length,
        p50: Number(times[10].toFixed(1)),
        max: Number(times.at(-1)!.toFixed(1)),
      };
    }
    report("processing latency (ms)", results);
  });
});
