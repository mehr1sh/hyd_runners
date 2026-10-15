import { describe, expect, it } from "vitest";
import {
  applyEdit,
  findRescheduleSlot,
  planWeek,
  runScheduler,
  toMinutes,
  toSchedulerResult,
  validateSchedule,
  type ProposedSession,
} from "@/features/scheduler/logic";
import { PlannedWorkout, SchedulerResult } from "@/lib/contracts";
import { block, normalWeek, settings } from "./fixtures";

const WEEK = "2026-10-19"; // a Monday
const TZ = "Asia/Kolkata";
const USER = "11111111-1111-4111-8111-111111111111";

function plan(availability = normalWeek, s = settings()) {
  return planWeek({ weekStart: WEEK, timezone: TZ, availability, settings: s });
}

describe("Case A: normal weekly timetable", () => {
  const out = plan(normalWeek, settings({ preferredTimesOfDay: ["early_morning"], maxSessionMinutes: 40 }));

  it("places every requested session and passes independent validation", () => {
    expect(out.proposal.sessions).toHaveLength(3);
    expect(out.violations).toEqual([]);
    expect(
      validateSchedule(out.proposal.sessions, { availability: normalWeek, settings: out.proposal.settings }),
    ).toEqual([]);
  });

  it("keeps sessions inside free time, never overlapping busy time", () => {
    for (const s of out.proposal.sessions) {
      const start = toMinutes(s.startTime);
      const fits = normalWeek.some(
        (b) =>
          b.kind === "free" &&
          b.weekday === s.weekday &&
          start >= toMinutes(b.startTime) &&
          start + s.durationMinutes <= toMinutes(b.endTime),
      );
      expect(fits).toBe(true);
    }
  });

  it("spaces hard sessions with recovery days and keeps rest days", () => {
    const days = out.proposal.sessions.map((s) => s.weekday);
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(2);
    expect(out.proposal.restDays.length).toBeGreaterThanOrEqual(3);
  });

  it("uses the preferred time of day and explains each placement", () => {
    for (const s of out.proposal.sessions) {
      expect(s.startTime).toBe("06:00");
      expect(s.durationMinutes).toBeLessThanOrEqual(40);
      expect(s.rationale.join(" ")).toMatch(/free time on/);
      expect(s.rationale.join(" ")).toMatch(/early morning/);
    }
  });

  it("converts to the shared SchedulerResult and PlannedWorkout contracts with IST instants", () => {
    const result = SchedulerResult.parse(toSchedulerResult(out.proposal, USER));
    expect(result.placed[0].startsAt).toBe("2026-10-19T00:30:00.000Z"); // Mon 06:00 IST
    for (const p of result.placed) {
      expect(PlannedWorkout.omit({ id: true, status: true }).safeParse(p).success).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    expect(plan(normalWeek, settings({ preferredTimesOfDay: ["early_morning"], maxSessionMinutes: 40 }))).toEqual(out);
  });
});

describe("Case B: very limited availability", () => {
  const limited = [block(2, "18:00", "18:25"), block(4, "07:00", "07:40")];

  it("returns a valid partial schedule and names what could not fit", () => {
    const out = plan(limited, settings({ sessionsPerWeek: 4, fitnessLevel: "returning" }));
    expect(out.violations).toEqual([]);
    expect(out.proposal.sessions.length).toBeLessThan(4);
    expect(out.proposal.sessions.length).toBeGreaterThan(0);
    expect(out.unplaced.length).toBeGreaterThan(0);
    expect(
      out.proposal.unsatisfied.find((u) => u.preference === "sessionsPerWeek")?.alternatives.length,
    ).toBeGreaterThan(0);
  });

  it("shortens to fit a short window and says so, but never below the minimum", () => {
    const out = plan(limited, settings({ sessionsPerWeek: 2 }));
    const tue = out.proposal.sessions.find((s) => s.weekday === 2);
    expect(tue?.durationMinutes).toBe(25); // 30-minute session, 25-minute window
    expect(tue?.rationale.join(" ")).toMatch(/Shortened/);
  });

  it("does not create sessions when nothing fits", () => {
    const out = plan([block(3, "12:00", "12:10")], settings());
    expect(out.proposal.sessions.filter((s) => s.workoutType !== "mobility")).toHaveLength(0);
    expect(out.violations).toEqual([]);
  });
});

describe("Case C: conflicting availability", () => {
  it("never places sessions in busy time that overlaps free time", () => {
    const availability = [block(1, "06:00", "09:00"), block(1, "06:30", "08:30", "busy"), block(3, "06:00", "07:00")];
    const out = plan(availability, settings({ sessionsPerWeek: 2, maxSessionMinutes: 30 }));
    expect(out.violations).toEqual([]);
    for (const s of out.proposal.sessions.filter((x) => x.weekday === 1)) {
      const start = toMinutes(s.startTime);
      expect(start >= toMinutes("08:30") || start + s.durationMinutes <= toMinutes("06:30")).toBe(true);
    }
  });

  it("validation reports busy overlaps and session overlaps with actionable messages", () => {
    const availability = [block(1, "06:00", "09:00"), block(1, "07:00", "08:00", "busy")];
    const sessions: ProposedSession[] = [
      {
        key: "a",
        weekday: 1,
        startTime: "06:45",
        durationMinutes: 30,
        workoutType: "walk",
        title: "Walk",
        rationale: [],
        plannedBy: "runner",
      },
      {
        key: "b",
        weekday: 1,
        startTime: "06:00",
        durationMinutes: 50,
        workoutType: "walk",
        title: "Walk 2",
        rationale: [],
        plannedBy: "runner",
      },
    ];
    const v = validateSchedule(sessions, {
      availability,
      settings: settings({ fitnessLevel: "regular", sessionsPerWeek: 5, maxSessionMinutes: 60 }),
    });
    expect(v.map((x) => x.code)).toEqual(
      expect.arrayContaining(["overlaps_busy", "overlaps_session", "too_many_per_day"]),
    );
    expect(v.find((x) => x.code === "overlaps_busy")?.message).toMatch(/07:00–08:00/);
  });
});

describe("Case G: preferences that cannot all be satisfied", () => {
  it("caps frequency for recovery and explains it", () => {
    const out = plan(normalWeek, settings({ sessionsPerWeek: 7 }));
    expect(out.proposal.sessions.length).toBeLessThanOrEqual(4);
    expect(out.proposal.warnings.join(" ")).toMatch(/at most 4 sessions/);
    expect(out.violations).toEqual([]);
  });

  it("relaxes preferred days (soft) instead of breaking recovery (hard)", () => {
    const out = plan(normalWeek, settings({ preferredDays: [1, 2, 3] }));
    const days = out.proposal.sessions.map((s) => s.weekday);
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
    expect(out.proposal.unsatisfied.some((u) => u.preference === "preferredDays")).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it("reports when preferred times have no room", () => {
    const out = plan(normalWeek, settings({ preferredTimesOfDay: ["afternoon"] }));
    expect(out.proposal.unsatisfied.some((u) => u.preference === "preferredTimesOfDay")).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it("explains when the duration limit is longer than every window", () => {
    const out = plan([block(1, "06:00", "06:15"), block(3, "06:00", "06:15")], settings({ maxSessionMinutes: 60 }));
    expect(out.unplaced[0].reason).toMatch(/at least 20 minutes/);
  });
});

describe("edits and rescheduling", () => {
  const base = plan(normalWeek, settings({ preferredTimesOfDay: ["early_morning"], maxSessionMinutes: 40 }));
  const ctx = { availability: normalWeek, settings: base.proposal.settings };

  it("accepts a valid edit and marks it as the runner's", () => {
    const first = base.proposal.sessions[0];
    const r = applyEdit(base.proposal.sessions, { kind: "update", key: first.key, patch: { startTime: "18:30" } }, ctx);
    expect(r.ok).toBe(true);
    expect(r.sessions.find((s) => s.key === first.key)).toMatchObject({ startTime: "18:30", plannedBy: "runner" });
  });

  it("rejects an edit into busy time and keeps the last valid week", () => {
    const first = base.proposal.sessions[0];
    const r = applyEdit(base.proposal.sessions, { kind: "update", key: first.key, patch: { startTime: "10:00" } }, ctx);
    expect(r.ok).toBe(false);
    expect(r.sessions).toEqual(base.proposal.sessions);
    if (!r.ok) expect(r.violations[0].code).toBe("overlaps_busy");
  });

  it("rejects moving a hard session next to another hard session", () => {
    const [a, b] = base.proposal.sessions;
    const r = applyEdit(base.proposal.sessions, { kind: "update", key: b.key, patch: { weekday: a.weekday + 1 } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.map((v) => v.code)).toContain("consecutive_hard_days");
  });

  it("reschedules a missed session into a valid later slot", () => {
    const [missed, ...others] = base.proposal.sessions; // Mon 06:00
    const r = findRescheduleSlot({
      missed,
      others,
      availability: normalWeek,
      settings: ctx.settings,
      notBefore: { weekday: 1, minutes: 8 * 60 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const moved = { ...missed, weekday: r.weekday, startTime: r.startTime };
      expect(validateSchedule([...others, moved], ctx)).toEqual([]);
    }
  });

  it("refuses to reschedule when only occupied or rule-breaking time remains", () => {
    const sessions = base.proposal.sessions;
    const missed = sessions[sessions.length - 1];
    const others = sessions.slice(0, -1);
    const r = findRescheduleSlot({
      missed,
      others,
      availability: normalWeek,
      settings: ctx.settings,
      notBefore: { weekday: 7, minutes: 23 * 60 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/left unchanged/);
  });
});

describe("contract entry point", () => {
  it("runs SchedulerInput → SchedulerResult and respects existing planned workouts", () => {
    const availability = normalWeek.map((b, i) => ({
      ...b,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      userId: USER,
      label: null,
      source: "manual" as const,
      sourceUploadId: null,
      confidence: null,
    }));
    const result = runScheduler(
      {
        weekStart: WEEK,
        timezone: TZ,
        availability,
        preferences: {
          userId: USER,
          goal: "first_5k",
          preferredDays: [],
          preferredTimesOfDay: [],
          sessionsPerWeek: 2,
          maxSessionMinutes: 30,
          timezone: TZ,
          remindersEnabled: false,
        },
        sessionsToPlace: [
          { programmeSessionId: null, title: "Week 1 Day 1", workoutType: "walk_run", durationMinutes: 30 },
          { programmeSessionId: null, title: "Week 1 Day 2", workoutType: "walk_run", durationMinutes: 30 },
        ],
        existing: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            userId: USER,
            enrollmentId: null,
            programmeSessionId: null,
            title: "Already planned",
            workoutType: "walk",
            startsAt: "2026-10-19T00:30:00Z",
            durationMinutes: 30,
            status: "planned",
            plannedBy: "runner",
          },
        ],
      },
      { fitnessLevel: "new_to_running", programmeWeek: 1 },
    );
    expect(result.violations).toEqual([]);
    expect(result.placed).toHaveLength(2);
    expect(result.placed.some((p) => p.startsAt.startsWith("2026-10-19"))).toBe(false);
  });
});
