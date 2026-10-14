/**
 * Builds the shared AchievementSummary contract (plus a few extras the
 * dashboard needs) from persisted records: ledger rows, earned badges and
 * completed workouts.
 */
import type { AchievementSummary } from "@/lib/contracts";
import { BADGE_BY_CODE } from "./badges";
import { characterStage } from "./character";
import { levelProgress } from "./levels";
import { MIN_ACTIVE_SECONDS, dailyStreak, weeklyStreak } from "./streaks";
import { localDate, type LocalDate } from "./time";

export type LedgerRow = { deltaXp: number; deltaCoins: number };
export type BadgeRow = { code: string; earnedAt: string };
export type ActivityRow = { startedAt: string; durationSeconds: number };

export function activeDates(workouts: ActivityRow[], tz: string): LocalDate[] {
  return [
    ...new Set(workouts.filter((w) => w.durationSeconds >= MIN_ACTIVE_SECONDS).map((w) => localDate(w.startedAt, tz))),
  ];
}

export function buildAchievementSummary(input: {
  userId: string;
  ledger: LedgerRow[];
  badges: BadgeRow[];
  workouts: ActivityRow[];
  timezone: string;
  today: LocalDate;
}) {
  const totalXp = input.ledger.reduce((s, r) => s + r.deltaXp, 0);
  const coins = input.ledger.reduce((s, r) => s + r.deltaCoins, 0);
  const lp = levelProgress(totalXp);
  const dates = activeDates(input.workouts, input.timezone);
  const daily = dailyStreak(dates, input.today);
  const weekly = weeklyStreak(dates, input.today);
  const character = characterStage(input.badges.map((b) => b.code));
  const recent = [...input.badges].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));

  const summary: AchievementSummary = {
    userId: input.userId,
    totalXp: Math.max(0, totalXp),
    coins: Math.max(0, coins),
    level: lp.level,
    xpIntoLevel: lp.xpIntoLevel,
    xpForNextLevel: lp.xpForNextLevel,
    currentStreakDays: daily.current,
    longestStreakDays: daily.longest,
    characterStage: character.stage,
    recentBadges: recent.slice(0, 5).map((b) => ({
      code: b.code,
      title: BADGE_BY_CODE.get(b.code)?.title ?? b.code,
      earnedAt: b.earnedAt,
    })),
  };

  return { summary, rank: lp.rank, daily, weekly, character, activeDates: dates };
}
