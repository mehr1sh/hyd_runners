import type { SchedulerInput, SchedulerResult, TimeOfDay } from "@/lib/contracts";
import { freeIntervals, subtractIntervals, type BlockLike, type Interval } from "./availability";
import { buildSessionPlan, isHard, RECOVERY_RULES, type SessionTemplate } from "./programme";
import { formatRange, fromMinutes, instantToLocal, localToInstant, toMinutes, weekdayName, weekdayShort } from "./time";
import type { PlannerSettings, ProposedSession, UnsatisfiedPreference, WeeklyProposal } from "./types";
import { validateSchedule, type ExistingSession } from "./validate-schedule";

/**
 * Deterministic weekly placement.
 *
 * 1. Build the session list for the week (programme.ts), capped by recovery rules.
 * 2. Compute usable free time per day: confirmed free blocks minus busy blocks
 *    minus any existing sessions.
 * 3. For each (session, day) find the best start: 15-minute steps inside a
 *    free window, preferring the runner's time of day, then the earliest.
 *    If the full length does not fit anywhere that day, the longest length
 *    down to the session's minimum is used (and explained).
 * 4. Exhaustively search assignments of sessions to distinct days (at most
 *    7 sessions × 8 choices, pruned by the recovery rules). The best plan
 *    places the most high-priority sessions, then scores preferred days,
 *    preferred times and even spacing of hard sessions. Ties keep the first
 *    plan found, and days are tried Monday first, so output is stable.
 * 5. Explain each placement from the decision actually made, list unmet
 *    preferences with alternatives, then validate independently.
 *
 * Same input → same output; there is no randomness or clock access.
 */

export const SLOT_STEP_MINUTES = 15;

/** Start-time windows for `TimeOfDay` preferences, in local minutes [start, end). */
export const TIME_OF_DAY_WINDOWS: Record<TimeOfDay, Interval> = {
  early_morning: { start: 5 * 60, end: 7 * 60 },
  morning: { start: 7 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 16 * 60 },
  evening: { start: 16 * 60, end: 20 * 60 },
  night: { start: 20 * 60, end: 24 * 60 },
};

const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  early_morning: "early morning",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night",
};

export type PlanWeekInput = {
  weekStart: string;
  timezone: string;
  availability: readonly BlockLike[];
  settings: PlannerSettings;
  existing?: readonly ExistingSession[];
  /** Overrides the programme's session list (used by the contract adapter). */
  templates?: SessionTemplate[];
};

type Slot = {
  start: number;
  duration: number;
  window: Interval;
  timeOfDay: TimeOfDay | null;
  preferredTime: boolean;
  shortened: boolean;
  score: number;
};

export type PlanWeekOutput = {
  proposal: WeeklyProposal;
  /** Sessions that could not be placed, with the reason. */
  unplaced: Array<{ title: string; reason: string }>;
  violations: ReturnType<typeof validateSchedule>;
};

function timeOfDayFor(start: number): TimeOfDay | null {
  for (const [key, w] of Object.entries(TIME_OF_DAY_WINDOWS) as Array<[TimeOfDay, Interval]>) {
    if (start >= w.start && start < w.end) return key;
  }
  return null;
}

function bestSlot(windows: readonly Interval[], template: SessionTemplate, settings: PlannerSettings): Slot | null {
  const preferred = new Set(settings.preferredTimesOfDay);
  const trySlots = (duration: number, shortened: boolean): Slot | null => {
    let best: Slot | null = null;
    for (const w of windows) {
      const first = Math.ceil(w.start / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
      for (let start = first; start + duration <= w.end; start += SLOT_STEP_MINUTES) {
        const tod = timeOfDayFor(start);
        const preferredTime = preferred.size > 0 && tod !== null && preferred.has(tod);
        // Preferred time dominates; earlier starts break ties (score falls slowly through the day).
        const score = (preferredTime ? 25 : 0) - start / (24 * 60);
        if (!best || score > best.score) {
          best = { start, duration, window: w, timeOfDay: tod, preferredTime, shortened, score };
        }
      }
    }
    return best;
  };
  const full = trySlots(template.durationMinutes, false);
  if (full) return full;
  for (let d = template.durationMinutes - 5; d >= template.minMinutes; d -= 5) {
    const slot = trySlots(d, true);
    if (slot) return { ...slot, score: slot.score - 10 };
  }
  return null;
}

export function planWeek(input: PlanWeekInput): PlanWeekOutput {
  const { settings } = input;
  const rules = RECOVERY_RULES[settings.fitnessLevel];
  const plan = input.templates ? { templates: input.templates, warnings: [] } : buildSessionPlan(settings);
  const templates = [...plan.templates].sort((a, b) => a.priority - b.priority);
  const warnings = [...plan.warnings];

  const free = freeIntervals(input.availability);
  for (let d = 1; d <= 7; d++) {
    const taken = (input.existing ?? [])
      .filter((e) => e.weekday === d)
      .map((e) => ({ start: e.startMinutes, end: e.endMinutes }));
    free[d] = subtractIntervals(free[d], taken);
  }
  const occupiedDays = new Set((input.existing ?? []).map((e) => e.weekday));

  const slots: Array<Array<Slot | null>> = templates.map((t) =>
    Array.from({ length: 8 }, (_, d) => (d === 0 || occupiedDays.has(d) ? null : bestSlot(free[d], t, settings))),
  );

  const preferredDays = new Set(settings.preferredDays);
  const daySelectable = (d: number) => !occupiedDays.has(d);

  // Exhaustive search with pruning. `choice[i]` = weekday for template i, or 0 when skipped.
  let bestChoice: number[] | null = null;
  let bestScore = -Infinity;
  const choice: number[] = [];
  const used = new Set<number>();

  const scoreOf = (picked: number[]) => {
    let score = 0;
    const hardDays: number[] = [];
    picked.forEach((d, i) => {
      if (!d) return;
      const t = templates[i];
      const slot = slots[i][d]!;
      score += 10_000 - t.priority * 100;
      score += slot.score;
      if (preferredDays.size > 0 && preferredDays.has(d)) score += 40;
      if (isHard(t.workoutType)) hardDays.push(d);
    });
    hardDays.sort((a, b) => a - b);
    let minGap = 7;
    for (let i = 1; i < hardDays.length; i++) minGap = Math.min(minGap, hardDays[i] - hardDays[i - 1]);
    if (hardDays.length > 1) score += 15 * Math.min(minGap, 3);
    return score;
  };

  const consecutiveOk = (picked: number[]) => {
    const hardDays = picked
      .map((d, i) => (d && isHard(templates[i].workoutType) ? d : 0))
      .filter(Boolean)
      .sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i < hardDays.length; i++) {
      run = hardDays[i] === hardDays[i - 1] + 1 ? run + 1 : 1;
      if (run > rules.maxConsecutiveHardDays) return false;
    }
    return true;
  };

  const maxDays = 7 - rules.minRestDays - occupiedDays.size;
  const search = (i: number) => {
    if (i === templates.length) {
      const score = scoreOf(choice);
      if (score > bestScore) {
        bestScore = score;
        bestChoice = [...choice];
      }
      return;
    }
    for (let d = 1; d <= 7; d++) {
      if (used.has(d) || !daySelectable(d) || !slots[i][d] || used.size >= maxDays) continue;
      choice.push(d);
      used.add(d);
      if (consecutiveOk(choice)) search(i + 1);
      used.delete(d);
      choice.pop();
    }
    choice.push(0);
    search(i + 1);
    choice.pop();
  };
  search(0);

  const picked: number[] = bestChoice ?? templates.map(() => 0);
  const sessions: ProposedSession[] = [];
  const unplaced: Array<{ title: string; reason: string }> = [];
  const unsatisfied: UnsatisfiedPreference[] = [];

  picked.forEach((d, i) => {
    const t = templates[i];
    if (!d) {
      unplaced.push({ title: t.title, reason: unplacedReason(t, slots[i], rules.minRestDays, settings) });
      return;
    }
    const slot = slots[i][d]!;
    sessions.push({
      key: t.key,
      weekday: d,
      startTime: fromMinutes(slot.start),
      durationMinutes: slot.duration,
      workoutType: t.workoutType,
      title: t.title,
      rationale: [],
      plannedBy: "scheduler",
    });
  });
  sessions.sort((a, b) => a.weekday - b.weekday);

  // Rationale from the actual placement.
  for (const s of sessions) {
    const i = templates.findIndex((t) => t.key === s.key);
    const t = templates[i];
    const slot = slots[i][s.weekday]!;
    const reasons: string[] = [];
    reasons.push(
      `Fits inside your free time on ${weekdayName(s.weekday)}, ${formatRange(slot.window.start, slot.window.end)}.`,
    );
    if (slot.shortened) {
      reasons.push(
        `Shortened from ${t.durationMinutes} to ${slot.duration} minutes because no longer free window was available that day.`,
      );
    } else if (t.idealMinutes > settings.maxSessionMinutes) {
      reasons.push(`${slot.duration} minutes keeps within your ${settings.maxSessionMinutes}-minute limit.`);
    } else {
      reasons.push(`${slot.duration} minutes, within your ${settings.maxSessionMinutes}-minute limit.`);
    }
    if (settings.preferredTimesOfDay.length > 0) {
      reasons.push(
        slot.preferredTime
          ? `Starts in the ${TIME_OF_DAY_LABEL[slot.timeOfDay!]}, a time you prefer.`
          : `None of your preferred times had room this day, so it uses the earliest free slot.`,
      );
    }
    if (preferredDays.size > 0 && !preferredDays.has(s.weekday)) {
      reasons.push(
        `${weekdayName(s.weekday)} is not one of your preferred days; it was used to keep recovery days or fit the session.`,
      );
    }
    if (isHard(s.workoutType)) {
      const otherHard = sessions.filter((o) => o.key !== s.key && isHard(o.workoutType)).map((o) => o.weekday);
      const next = otherHard.filter((d) => d > s.weekday).sort((a, b) => a - b)[0];
      if (next) {
        reasons.push(
          next - s.weekday === 1
            ? `Next hard session is the following day (allowed for your level).`
            : `Leaves ${next - s.weekday - 1} recovery day${next - s.weekday - 1 === 1 ? "" : "s"} before the next hard session on ${weekdayName(next)}.`,
        );
      }
    }
    reasons.push(`This session ${t.purpose}.`);
    s.rationale = reasons.slice(0, 8);
  }

  // Preferences that could not be met.
  if (sessions.length < settings.sessionsPerWeek) {
    unsatisfied.push({
      preference: "sessionsPerWeek",
      message: `${sessions.length} of the ${settings.sessionsPerWeek} sessions you asked for fit this week.`,
      alternatives: [
        "Add free time on more days of the week.",
        "Lower the number of sessions per week.",
        ...(unplaced.length > 0 && templates.some((t) => t.minMinutes > 15)
          ? ["Shorter free periods (20 minutes or more) can still fit a short session."]
          : []),
      ],
    });
  }
  if (preferredDays.size > 0) {
    const off = sessions.filter((s) => !preferredDays.has(s.weekday));
    if (off.length > 0) {
      unsatisfied.push({
        preference: "preferredDays",
        message: `${off.map((s) => weekdayName(s.weekday)).join(", ")} ${off.length === 1 ? "is" : "are"} outside your preferred days.`,
        alternatives: [
          "Add free time on your preferred days.",
          "Add more preferred days so recovery days can be spaced out.",
        ],
      });
    }
  }
  if (settings.preferredTimesOfDay.length > 0) {
    const off = sessions.filter((s) => {
      const i = templates.findIndex((t) => t.key === s.key);
      return !slots[i][s.weekday]!.preferredTime;
    });
    if (off.length > 0) {
      unsatisfied.push({
        preference: "preferredTimesOfDay",
        message: `${off.map((s) => `${weekdayShort(s.weekday)} ${s.startTime}`).join(", ")} ${off.length === 1 ? "is" : "are"} outside your preferred time of day.`,
        alternatives: ["Add free time during your preferred part of the day.", "Allow another time of day."],
      });
    }
  }
  for (const u of unplaced) {
    unsatisfied.push({ preference: "session", message: `${u.title}: ${u.reason}`, alternatives: [] });
  }

  const daysWithSessions = new Set(sessions.map((s) => s.weekday));
  const proposal: WeeklyProposal = {
    weekStart: input.weekStart,
    timezone: input.timezone,
    settings,
    sessions,
    restDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => !daysWithSessions.has(d)),
    unsatisfied,
    warnings,
    source: "deterministic",
  };
  const violations = validateSchedule(sessions, {
    availability: input.availability,
    settings,
    existing: input.existing,
  });
  return { proposal, unplaced, violations };
}

function unplacedReason(
  t: SessionTemplate,
  daySlots: Array<Slot | null>,
  minRestDays: number,
  settings: PlannerSettings,
): string {
  const feasibleDays = daySlots.filter(Boolean).length;
  if (feasibleDays === 0) {
    return `no free period is at least ${t.minMinutes} minutes long${settings.maxSessionMinutes < t.minMinutes ? ` and your limit is ${settings.maxSessionMinutes} minutes` : ""}.`;
  }
  return `not enough separate days with a ${t.minMinutes}+ minute free period while keeping ${minRestDays} rest day${minRestDays === 1 ? "" : "s"} and space between hard sessions.`;
}

/** Contract view of a proposal: `SchedulerResult` with dated UTC instants. */
export function toSchedulerResult(
  proposal: Pick<WeeklyProposal, "weekStart" | "timezone" | "sessions">,
  userId: string,
  unplaced: Array<{ title: string; reason: string }> = [],
): SchedulerResult {
  return {
    placed: proposal.sessions.map((s) => ({
      userId,
      enrollmentId: null,
      programmeSessionId: null,
      title: s.title,
      workoutType: s.workoutType,
      startsAt: localToInstant(proposal.weekStart, s.weekday, toMinutes(s.startTime), proposal.timezone),
      durationMinutes: s.durationMinutes,
      plannedBy: s.plannedBy,
    })),
    unplaced,
  };
}

/**
 * The contract entry point: `SchedulerInput → SchedulerResult`. Fitness level
 * and programme week are not in `SchedulerInput`, so they are passed alongside.
 */
export function runScheduler(
  input: SchedulerInput,
  extra: Pick<PlannerSettings, "fitnessLevel" | "programmeWeek">,
): SchedulerResult & { violations: ReturnType<typeof validateSchedule> } {
  const settings: PlannerSettings = {
    goal: input.preferences.goal,
    fitnessLevel: extra.fitnessLevel,
    sessionsPerWeek: input.preferences.sessionsPerWeek,
    maxSessionMinutes: input.preferences.maxSessionMinutes,
    preferredDays: input.preferences.preferredDays,
    preferredTimesOfDay: input.preferences.preferredTimesOfDay,
    programmeWeek: extra.programmeWeek,
  };
  const templates: SessionTemplate[] | undefined =
    input.sessionsToPlace.length > 0
      ? input.sessionsToPlace
          .filter((s) => s.workoutType !== "rest")
          .map((s, i) => ({
            key: `s${i + 1}`,
            title: s.title,
            workoutType: s.workoutType as SessionTemplate["workoutType"],
            durationMinutes: Math.min(s.durationMinutes, settings.maxSessionMinutes),
            idealMinutes: s.durationMinutes,
            minMinutes: Math.min(s.durationMinutes, 20),
            priority: i,
            purpose: "is part of your programme for this week",
          }))
      : undefined;
  const existing: ExistingSession[] = input.existing
    .filter((w) => w.status === "planned")
    .map((w) => ({ w, local: instantToLocal(w.startsAt, input.timezone) }))
    .filter(({ local }) => local.weekStart === input.weekStart)
    .map(({ w, local }, i) => ({
      key: `existing-${i}`,
      weekday: local.weekday,
      startMinutes: local.minutes,
      endMinutes: local.minutes + w.durationMinutes,
    }));
  const { proposal, unplaced, violations } = planWeek({
    weekStart: input.weekStart,
    timezone: input.timezone,
    availability: input.availability,
    settings,
    existing,
    templates,
  });
  return { ...toSchedulerResult(proposal, input.preferences.userId, unplaced), violations };
}
