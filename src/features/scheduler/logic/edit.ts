import { freeIntervals, type BlockLike } from "./availability";
import { SLOT_STEP_MINUTES, TIME_OF_DAY_WINDOWS } from "./schedule";
import { fromMinutes, toMinutes, weekdayName } from "./time";
import type { PlannerSettings, ProposedSession, ScheduleViolation } from "./types";
import { validateSchedule, type ExistingSession } from "./validate-schedule";

/**
 * Edits and rescheduling. Every change is applied to a copy, the whole week
 * is revalidated, and the change is rejected (keeping the last valid week)
 * if any hard constraint breaks. Other sessions are never moved to make room.
 */

export type SessionEdit =
  | {
      kind: "update";
      key: string;
      patch: Partial<Pick<ProposedSession, "weekday" | "startTime" | "durationMinutes" | "workoutType" | "title">>;
    }
  | { kind: "remove"; key: string }
  | { kind: "add"; session: ProposedSession };

export type EditContext = {
  availability: readonly BlockLike[];
  settings: PlannerSettings;
  existing?: readonly ExistingSession[];
};

export function applyEdit(
  sessions: readonly ProposedSession[],
  edit: SessionEdit,
  ctx: EditContext,
):
  | { ok: true; sessions: ProposedSession[] }
  | { ok: false; sessions: ProposedSession[]; violations: ScheduleViolation[] } {
  let next: ProposedSession[];
  switch (edit.kind) {
    case "remove":
      next = sessions.filter((s) => s.key !== edit.key);
      break;
    case "add":
      if (sessions.some((s) => s.key === edit.session.key)) {
        return {
          ok: false,
          sessions: [...sessions],
          violations: [
            { code: "invalid_session", sessionKeys: [edit.session.key], message: "That session already exists." },
          ],
        };
      }
      next = [...sessions, { ...edit.session, plannedBy: "runner", rationale: ["Added by you."] }];
      break;
    case "update":
      next = sessions.map((s) =>
        s.key === edit.key
          ? {
              ...s,
              ...edit.patch,
              plannedBy: "runner" as const,
              rationale: ["Changed by you; checked against your free time and recovery rules."],
            }
          : s,
      );
      break;
  }
  next.sort((a, b) => a.weekday - b.weekday || toMinutes(a.startTime) - toMinutes(b.startTime));
  const violations = validateSchedule(next, ctx);
  if (violations.length > 0) return { ok: false, sessions: [...sessions], violations };
  return { ok: true, sessions: next };
}

export type RescheduleResult =
  { ok: true; weekday: number; startTime: string; rationale: string[] } | { ok: false; reason: string };

/**
 * Find a new slot for a missed session in the rest of the same week.
 *
 * `others` are the week's other sessions that still occupy their day
 * (planned or completed). The search looks from `notBefore` to Sunday, day by
 * day, and inside each day prefers the runner's time of day, then the
 * earliest start. The first slot that passes full validation wins. If none
 * does, nothing changes and the reason says which constraint blocked it.
 */
export function findRescheduleSlot(input: {
  missed: ProposedSession;
  others: readonly ProposedSession[];
  availability: readonly BlockLike[];
  settings: PlannerSettings;
  notBefore: { weekday: number; minutes: number };
}): RescheduleResult {
  const { missed, others, settings } = input;
  const free = freeIntervals(input.availability);
  const preferred = new Set(settings.preferredTimesOfDay);
  const ctx = { availability: input.availability, settings };
  let fitsTimeButBreaksRules = false;

  for (let weekday = Math.max(1, input.notBefore.weekday); weekday <= 7; weekday++) {
    const earliest = weekday === input.notBefore.weekday ? input.notBefore.minutes : 0;
    const candidates: Array<{ start: number; preferredTime: boolean }> = [];
    for (const w of free[weekday]) {
      const first = Math.ceil(Math.max(w.start, earliest) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
      for (let start = first; start + missed.durationMinutes <= w.end; start += SLOT_STEP_MINUTES) {
        const preferredTime = [...preferred].some(
          (p) => start >= TIME_OF_DAY_WINDOWS[p].start && start < TIME_OF_DAY_WINDOWS[p].end,
        );
        candidates.push({ start, preferredTime });
      }
    }
    candidates.sort((a, b) => Number(b.preferredTime) - Number(a.preferredTime) || a.start - b.start);
    for (const c of candidates) {
      const moved: ProposedSession = { ...missed, weekday, startTime: fromMinutes(c.start) };
      const violations = validateSchedule([...others, moved], ctx);
      if (violations.length === 0) {
        return {
          ok: true,
          weekday,
          startTime: moved.startTime,
          rationale: [
            `Moved from ${weekdayName(missed.weekday)} ${missed.startTime} to the next free slot that keeps your recovery days.`,
            `Fits inside your free time on ${weekdayName(weekday)}.`,
          ],
        };
      }
      if (violations.every((v) => v.code !== "outside_availability" && v.code !== "overlaps_busy")) {
        fitsTimeButBreaksRules = true;
      }
    }
  }

  return {
    ok: false,
    reason: fitsTimeButBreaksRules
      ? "There is free time left this week, but every option would break a recovery rule (one session a day, rest days, or no back-to-back hard days). Your plan was left unchanged; it is fine to skip this one."
      : `No free period of ${missed.durationMinutes} minutes is left this week. Your plan was left unchanged. Add free time or skip this session.`,
  };
}
