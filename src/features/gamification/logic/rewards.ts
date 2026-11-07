/**
 * Reward engine — the single source of truth for XP, coins, badges,
 * streak milestones and weekly challenges.
 *
 * `computeRewards(history)` is a pure function of the runner's completed
 * workouts. Every award carries a deterministic `awardKey`; the server
 * inserts awards with ON CONFLICT DO NOTHING on (user_id, award_key), so
 * re-running it — after a retry, a duplicate request or a new workout —
 * can never pay the same reward twice.
 */
import { BADGE_BY_CODE, MOBILITY_TYPES, RUN_TYPES, STRENGTH_TYPES } from "./badges";
import { CHALLENGES } from "./challenges";
import { MIN_ACTIVE_SECONDS, WEEKLY_GOAL_DAYS } from "./streaks";
import { addDays, daysBetween, localDate, localHour, weekStart, type LocalDate } from "./time";
import type {
  Award,
  BadgeEarned,
  ChallengeDone,
  EnrollmentDone,
  RewardHistory,
  RewardOutcome,
  WorkoutFact,
} from "./types";

export const RULES = {
  workoutBaseXp: 20,
  workoutXpPerFiveMinutes: 1,
  workoutDurationBonusCap: 12, // +12 XP max (60 minutes)
  workoutCoins: 5,
  planBonusXp: 10,
  planBonusCoins: 2,
  /** Recovery guard: at most this many rewarded days in any 7-day window. */
  maxRewardedDaysPerWeekWindow: 6,
  dailyStreakMilestones: [
    { days: 3, xp: 15, coins: 5 },
    { days: 7, xp: 40, coins: 10 },
    { days: 14, xp: 80, coins: 20 },
    { days: 30, xp: 150, coins: 40 },
    { days: 60, xp: 300, coins: 80 },
  ],
  weeklyStreakMilestones: [
    { weeks: 2, xp: 30, coins: 10 },
    { weeks: 4, xp: 60, coins: 15 },
    { weeks: 8, xp: 120, coins: 30 },
    { weeks: 12, xp: 200, coins: 50 },
  ],
  earlyBirdBeforeHour: 7,
} as const;

export function workoutXp(durationSeconds: number) {
  const bonus = Math.min(
    RULES.workoutDurationBonusCap,
    Math.floor(durationSeconds / 300) * RULES.workoutXpPerFiveMinutes,
  );
  return RULES.workoutBaseXp + bonus;
}

/** Chronological by start time, so local days are processed in order. */
const chronological = (a: WorkoutFact, b: WorkoutFact) =>
  new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || a.id.localeCompare(b.id);

export function computeRewards(history: RewardHistory): RewardOutcome {
  const tz = history.timezone;
  const workouts = [...history.workouts].sort(chronological);
  const awards: Award[] = [];
  const badges: BadgeEarned[] = [];
  const badgeSet = new Set<string>();
  const challenges: ChallengeDone[] = [];
  const completedEnrollments: EnrollmentDone[] = [];
  const recoveryCappedDays: LocalDate[] = [];

  const earnBadge = (code: string, at: string) => {
    if (badgeSet.has(code)) return;
    const def = BADGE_BY_CODE.get(code);
    if (!def) return;
    badgeSet.add(code);
    badges.push({ code, earnedAt: at });
    if (def.xp || def.coins)
      awards.push({
        awardKey: `badge:${code}`,
        reason: "badge_earned",
        deltaXp: def.xp,
        deltaCoins: def.coins,
        refTable: null,
        refId: null,
        occurredAt: at,
        label: `Badge: ${def.title}`,
      });
  };

  // Running state, updated workout by workout in completion order.
  const rewardedDays: LocalDate[] = [];
  const planBonusDays = new Set<LocalDate>();
  const activeDays = new Set<LocalDate>();
  let completedCount = 0;
  let runDistance = 0;
  const kinds = { run: false, strength: false, mobility: false };
  let dailyRun: { start: LocalDate; end: LocalDate } | null = null;
  const dailyPaid = new Set<number>();
  const weekActive = new Map<LocalDate, Set<LocalDate>>();
  let weeklyRun: { start: LocalDate; end: LocalDate; length: number } | null = null;
  const weeklyPaid = new Set<number>();
  const weekWorkouts = new Map<LocalDate, WorkoutFact[]>();
  const challengeSet = new Set<string>();
  const sessionsDone = new Map<string, Set<string>>(); // enrollmentId -> sessionIds
  const enrollments = new Map(history.enrollments.map((e) => [e.enrollmentId, e]));
  const existing = [...(history.existingAwardKeys ?? [])];
  /** A milestone of this size was already paid for a run starting inside [from, to]. */
  const paidInRange = (prefix: string, from: LocalDate, to: LocalDate) =>
    existing.some((k) => {
      if (!k.startsWith(prefix)) return false;
      const start = k.slice(prefix.length);
      return start >= from && start <= to;
    });

  for (const w of workouts) {
    const day = localDate(w.startedAt, tz);
    const at = w.completedAt;
    const active = w.durationSeconds >= MIN_ACTIVE_SECONDS;
    completedCount++;

    // 1. Daily workout XP: first active workout of each local day, unless the
    //    recovery guard applies (6 rewarded days already in the last 7).
    if (active && !rewardedDays.includes(day)) {
      const recent = rewardedDays.filter((d) => daysBetween(d, day) >= 1 && daysBetween(d, day) <= 6).length;
      if (recent >= RULES.maxRewardedDaysPerWeekWindow) {
        if (!recoveryCappedDays.includes(day)) recoveryCappedDays.push(day);
      } else {
        rewardedDays.push(day);
        awards.push({
          awardKey: `workout:day:${day}`,
          reason: "workout_completed",
          deltaXp: workoutXp(w.durationSeconds),
          deltaCoins: RULES.workoutCoins,
          refTable: "workout_logs",
          refId: w.id,
          occurredAt: at,
          label: "Workout completed",
        });
      }
    }

    // 2. Plan bonus: completing a programme session, or a planned workout on
    //    its planned day. At most one plan bonus per day, and only on a
    //    rewarded day (no bonus for doubling up sessions).
    const onPlan = !!w.programmeSessionId || (!!w.plannedWorkoutId && w.plannedDate === day);
    if (onPlan && active && rewardedDays.includes(day) && !planBonusDays.has(day)) {
      planBonusDays.add(day);
      awards.push({
        awardKey: w.programmeSessionId
          ? `plan:session:${w.enrollmentId}:${w.programmeSessionId}`
          : `plan:planned:${w.plannedWorkoutId}`,
        reason: "planned_workout_on_time",
        deltaXp: RULES.planBonusXp,
        deltaCoins: RULES.planBonusCoins,
        refTable: "workout_logs",
        refId: w.id,
        occurredAt: at,
        label: "Followed your plan",
      });
    }

    // 3. Habit-streak milestones.
    if (active && !activeDays.has(day)) {
      activeDays.add(day);
      if (dailyRun && daysBetween(dailyRun.end, day) <= 2) dailyRun.end = day;
      else {
        dailyRun = { start: day, end: day };
        dailyPaid.clear();
      }
      const length = daysBetween(dailyRun.start, dailyRun.end) + 1;
      for (const m of RULES.dailyStreakMilestones) {
        if (length >= m.days && !dailyPaid.has(m.days)) {
          dailyPaid.add(m.days);
          if (paidInRange(`streak:daily:${m.days}:`, dailyRun.start, day)) continue;
          awards.push({
            awardKey: `streak:daily:${m.days}:${dailyRun.start}`,
            reason: "streak_milestone",
            deltaXp: m.xp,
            deltaCoins: m.coins,
            refTable: null,
            refId: null,
            occurredAt: at,
            label: `${m.days}-day habit streak`,
          });
        }
      }
      if (length >= 7) earnBadge("streak-7", at);

      // 4. Weekly-goal streak milestones.
      const ws = weekStart(day);
      const set = weekActive.get(ws) ?? new Set<LocalDate>();
      set.add(day);
      weekActive.set(ws, set);
      if (set.size === WEEKLY_GOAL_DAYS) {
        if (weeklyRun && daysBetween(weeklyRun.end, ws) === 7) {
          weeklyRun.end = ws;
          weeklyRun.length++;
        } else {
          weeklyRun = { start: ws, end: ws, length: 1 };
          weeklyPaid.clear();
        }
        for (const m of RULES.weeklyStreakMilestones) {
          if (weeklyRun.length >= m.weeks && !weeklyPaid.has(m.weeks)) {
            weeklyPaid.add(m.weeks);
            if (paidInRange(`streak:weekly:${m.weeks}:`, weeklyRun.start, ws)) continue;
            awards.push({
              awardKey: `streak:weekly:${m.weeks}:${weeklyRun.start}`,
              reason: "streak_milestone",
              deltaXp: m.xp,
              deltaCoins: m.coins,
              refTable: null,
              refId: null,
              occurredAt: at,
              label: `${m.weeks} weeks meeting your goal`,
            });
          }
        }
        if (weeklyRun.length >= 4) earnBadge("weekly-streak-4", at);
      }
    }

    // 5. Count, distance and variety badges.
    if (completedCount >= 1) earnBadge("first-workout", at);
    if (completedCount >= 5) earnBadge("workouts-5", at);
    if (completedCount >= 25) earnBadge("workouts-25", at);
    if (completedCount >= 50) earnBadge("workouts-50", at);
    if (RUN_TYPES.has(w.workoutType)) {
      runDistance += w.distanceMeters ?? 0;
      kinds.run = true;
    }
    if (STRENGTH_TYPES.has(w.workoutType)) kinds.strength = true;
    if (MOBILITY_TYPES.has(w.workoutType)) kinds.mobility = true;
    if (runDistance >= 5000) earnBadge("distance-5k", at);
    if (runDistance >= 42195) earnBadge("distance-42k", at);
    if (kinds.run && kinds.strength && kinds.mobility) earnBadge("all-rounder", at);
    if (active && localHour(w.startedAt, tz) < RULES.earlyBirdBeforeHour) earnBadge("early-bird", at);

    // 6. Weekly challenges.
    const ws = weekStart(day);
    const list = weekWorkouts.get(ws) ?? [];
    list.push(w);
    weekWorkouts.set(ws, list);
    for (const c of CHALLENGES) {
      const key = `${c.code}:${ws}`;
      if (!challengeSet.has(key) && c.progress(list, tz) >= c.target) {
        challengeSet.add(key);
        challenges.push({ code: c.code, weekStart: ws, completedAt: at });
      }
    }
    if (challenges.length >= 3) earnBadge("challenges-3", at);

    // 7. Programme milestones.
    if (w.enrollmentId && w.programmeSessionId) {
      const done = sessionsDone.get(w.enrollmentId) ?? new Set<string>();
      done.add(w.programmeSessionId);
      sessionsDone.set(w.enrollmentId, done);
      const e = enrollments.get(w.enrollmentId);
      if (e) {
        const weekDone = (week: number) => {
          const ids = e.sessions.filter((s) => s.week === week).map((s) => s.id);
          return ids.length > 0 && ids.every((id) => done.has(id));
        };
        if (e.programmeSlug === "couch-to-5k") {
          if (weekDone(1)) earnBadge("c25k-week-1", at);
          if (weekDone(5)) earnBadge("c25k-halfway", at);
        }
        if (e.sessions.length > 0 && e.sessions.every((s) => done.has(s.id))) {
          if (!completedEnrollments.some((c) => c.enrollmentId === e.enrollmentId))
            completedEnrollments.push({ enrollmentId: e.enrollmentId, completedAt: at });
          earnBadge("programme-complete", at);
          if (e.programmeSlug === "couch-to-5k") earnBadge("c25k-graduate", at);
        }
      }
    }
  }

  if (history.firstRsvpAt) earnBadge("community-first-rsvp", history.firstRsvpAt);

  return { awards, badges, challenges, completedEnrollments, recoveryCappedDays };
}

/** Days in the last 7 (ending yesterday) that already earned workout XP. */
export function recoveryCheck(rewardedDays: Iterable<LocalDate>, today: LocalDate) {
  const window = new Set<LocalDate>();
  for (let i = 1; i <= 6; i++) window.add(addDays(today, -i));
  const recent = [...new Set(rewardedDays)].filter((d) => window.has(d)).length;
  return { recentRewardedDays: recent, restRecommended: recent >= RULES.maxRewardedDaysPerWeekWindow };
}
