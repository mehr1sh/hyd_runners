import { busyIntervals, freeIntervals, type BlockLike } from "./availability";
import { isHard, MIN_SESSION_MINUTES, RECOVERY_RULES } from "./programme";
import { formatRange, MINUTES_PER_DAY, toMinutes, weekdayName } from "./time";
import { ProposedSession, type PlannerSettings, type ScheduleViolation } from "./types";

/**
 * Independent check of a weekly schedule against every hard constraint. It
 * shares no code with placement (schedule.ts), so a placement bug cannot
 * also hide itself here. Every schedule passes through this before it is
 * returned, approved, persisted or rescheduled, including AI suggestions.
 *
 * Hard constraints:
 *  1. Each session is valid (`ProposedSession` schema, not `rest`).
 *  2. Duration is between 10 minutes and the runner's limit.
 *  3. A session sits entirely inside one confirmed free period, does not
 *     touch busy time and does not cross midnight.
 *  4. Sessions do not overlap each other or other existing sessions.
 *  5. Session count stays within the runner's frequency and the recovery cap.
 *  6. At most one session per day, rest days and hard-day spacing are kept.
 * Consecutive-day checks look at Monday–Sunday of one week only.
 */

export type ExistingSession = { key: string; weekday: number; startMinutes: number; endMinutes: number };

export type ValidationContext = {
  availability: readonly BlockLike[];
  settings: PlannerSettings;
  /** Sessions outside this proposal that must not be overlapped (e.g. rescheduling). */
  existing?: readonly ExistingSession[];
};

export function validateSchedule(sessions: readonly unknown[], ctx: ValidationContext): ScheduleViolation[] {
  const violations: ScheduleViolation[] = [];
  const rules = RECOVERY_RULES[ctx.settings.fitnessLevel];
  const free = freeIntervals(ctx.availability);
  const busy = busyIntervals(ctx.availability);

  const valid: Array<ProposedSession & { start: number; end: number }> = [];
  sessions.forEach((raw, i) => {
    const parsed = ProposedSession.safeParse(raw);
    if (!parsed.success) {
      const key = typeof raw === "object" && raw && "key" in raw ? String((raw as { key: unknown }).key) : `#${i + 1}`;
      violations.push({
        code: "invalid_session",
        sessionKeys: [key],
        message: `Session ${i + 1} is incomplete or has an unsupported type.`,
      });
      return;
    }
    const s = parsed.data;
    const start = toMinutes(s.startTime);
    valid.push({ ...s, start, end: start + s.durationMinutes });
  });

  for (const s of valid) {
    const label = `${weekdayName(s.weekday)} ${s.startTime} ${s.title}`;
    if (s.durationMinutes < MIN_SESSION_MINUTES || s.durationMinutes > ctx.settings.maxSessionMinutes) {
      violations.push({
        code: "duration_out_of_range",
        sessionKeys: [s.key],
        message: `${label}: ${s.durationMinutes} minutes is outside the allowed ${MIN_SESSION_MINUTES}–${ctx.settings.maxSessionMinutes} minutes.`,
      });
    }
    if (s.end > MINUTES_PER_DAY) {
      violations.push({
        code: "outside_availability",
        sessionKeys: [s.key],
        message: `${label}: sessions cannot run past midnight.`,
      });
      continue;
    }
    const inside = free[s.weekday].some((i) => s.start >= i.start && s.end <= i.end);
    if (!inside) {
      const clash = busy[s.weekday].find((b) => s.start < b.end && s.end > b.start);
      violations.push(
        clash
          ? {
              code: "overlaps_busy",
              sessionKeys: [s.key],
              message: `${label}: overlaps your busy time ${formatRange(clash.start, clash.end)}.`,
            }
          : {
              code: "outside_availability",
              sessionKeys: [s.key],
              message: `${label}: ${formatRange(s.start, s.end)} is not inside your confirmed free time.`,
            },
      );
    }
    for (const e of ctx.existing ?? []) {
      if (e.weekday === s.weekday && s.start < e.endMinutes && s.end > e.startMinutes) {
        violations.push({
          code: "overlaps_existing",
          sessionKeys: [s.key, e.key],
          message: `${label}: overlaps another planned session at ${formatRange(e.startMinutes, e.endMinutes)}.`,
        });
      }
    }
  }

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if (a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
        violations.push({
          code: "overlaps_session",
          sessionKeys: [a.key, b.key],
          message: `${weekdayName(a.weekday)}: “${a.title}” and “${b.title}” overlap.`,
        });
      }
    }
  }

  const allowed = Math.min(ctx.settings.sessionsPerWeek, rules.maxSessionsPerWeek);
  if (valid.length > allowed) {
    violations.push({
      code: "too_many_sessions",
      sessionKeys: [],
      message: `${valid.length} sessions is more than the ${allowed} allowed this week.`,
    });
  }
  const hard = valid.filter((s) => isHard(s.workoutType));
  if (hard.length > rules.maxHardPerWeek) {
    violations.push({
      code: "too_many_sessions",
      sessionKeys: hard.map((s) => s.key),
      message: `${hard.length} hard sessions is more than the ${rules.maxHardPerWeek} allowed for your level.`,
    });
  }

  const byDay = new Map<number, typeof valid>();
  for (const s of valid) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
  for (const [weekday, list] of byDay) {
    if (list.length > rules.maxSessionsPerDay) {
      violations.push({
        code: "too_many_per_day",
        sessionKeys: list.map((s) => s.key),
        message: `${weekdayName(weekday)} has ${list.length} sessions; keep one per day.`,
      });
    }
  }

  const restDays = 7 - byDay.size;
  if (valid.length > 0 && restDays < rules.minRestDays) {
    violations.push({
      code: "not_enough_rest_days",
      sessionKeys: [],
      message: `Only ${restDays} rest day${restDays === 1 ? "" : "s"}; keep at least ${rules.minRestDays}.`,
    });
  }

  const hardDays = [...new Set(hard.map((s) => s.weekday))].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < hardDays.length; i++) {
    run = hardDays[i] === hardDays[i - 1] + 1 ? run + 1 : 1;
    if (run > rules.maxConsecutiveHardDays) {
      const keys = hard.filter((s) => s.weekday === hardDays[i] || s.weekday === hardDays[i - 1]).map((s) => s.key);
      violations.push({
        code: "consecutive_hard_days",
        sessionKeys: keys,
        message:
          rules.maxConsecutiveHardDays === 1
            ? `Hard sessions on ${weekdayName(hardDays[i - 1])} and ${weekdayName(hardDays[i])} are back to back; leave a rest or easy day between them.`
            : `More than ${rules.maxConsecutiveHardDays} hard days in a row ending ${weekdayName(hardDays[i])}.`,
      });
    }
  }

  return violations;
}
