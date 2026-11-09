import type { Split } from "./normalize";

/**
 * Pacing from full kilometre splits: second half vs first half, and how much
 * split paces vary (coefficient of variation). Null below two full splits —
 * precise splits are never derived from manual totals.
 */
export function pacingAnalysis(splits: Split[] | null) {
  const full = (splits ?? []).filter((s) => !s.partial);
  if (full.length < 2) return null;
  const half = Math.floor(full.length / 2);
  const first = full.slice(0, half);
  const second = full.slice(full.length - half);
  const avg = (xs: Split[]) => xs.reduce((t, s) => t + s.pace, 0) / xs.length;
  const firstPace = avg(first);
  const secondPace = avg(second);
  const diffPct = ((secondPace - firstPace) / firstPace) * 100;
  const mean = avg(full);
  const sd = Math.sqrt(full.reduce((t, s) => t + (s.pace - mean) ** 2, 0) / full.length);
  const cv = (sd / mean) * 100;
  const fastest = full.reduce((a, b) => (b.pace < a.pace ? b : a));
  const slowest = full.reduce((a, b) => (b.pace > a.pace ? b : a));
  return {
    kind: diffPct < -1 ? ("negative" as const) : diffPct > 1 ? ("positive" as const) : ("even" as const),
    firstHalfPace: Math.round(firstPace),
    secondHalfPace: Math.round(secondPace),
    diffPct: Math.round(diffPct * 10) / 10,
    variationPct: Math.round(cv * 10) / 10,
    consistency: cv < 3 ? ("very even" as const) : cv < 6 ? ("steady" as const) : ("variable" as const),
    fastest: { index: fastest.index, pace: fastest.pace },
    slowest: { index: slowest.index, pace: slowest.pace },
  };
}

export type DnaActivity = {
  startedAt: string;
  /** Local ISO weekday, 1 = Monday. */
  weekday: number;
  /** Weeks before the current week (0 = this week). */
  weeksAgo: number;
  distanceM: number;
  avgPace: number | null;
  type: "run" | "walk_run" | "walk" | "hike";
};

export type DnaTrait = { key: string; title: string; evidence: string };

/**
 * Descriptive, changing profiles from the last 16 weeks. Every trait states the
 * evidence it rests on; with fewer than 4 activities in 8 weeks nothing is said.
 */
export function runningDna(acts: DnaActivity[]): { traits: DnaTrait[]; trend: string | null; enoughData: boolean } {
  const last8 = acts.filter((a) => a.weeksAgo < 8);
  if (last8.length < 4) return { traits: [], trend: null, enoughData: false };
  const traits: DnaTrait[] = [];
  const km = (m: number) => Math.round(m / 100) / 10;

  const activeWeeks = new Set(last8.map((a) => a.weeksAgo)).size;
  if (activeWeeks >= 6) {
    traits.push({
      key: "consistency",
      title: "The Consistency Runner",
      evidence: `You were active in ${activeWeeks} of the last 8 weeks.`,
    });
  }

  const total = last8.reduce((t, a) => t + a.distanceM, 0);
  const weekend = last8.filter((a) => a.weekday >= 6).reduce((t, a) => t + a.distanceM, 0);
  if (total > 0 && weekend / total >= 0.6) {
    traits.push({
      key: "weekend",
      title: "The Weekend Explorer",
      evidence: `${Math.round((weekend / total) * 100)}% of your distance in the last 8 weeks came on Saturdays and Sundays.`,
    });
  }

  const longest = (xs: DnaActivity[]) => xs.reduce((m, a) => Math.max(m, a.distanceM), 0);
  const recentLong = longest(acts.filter((a) => a.weeksAgo < 4));
  const earlierLong = longest(acts.filter((a) => a.weeksAgo >= 4 && a.weeksAgo < 8));
  if (earlierLong >= 3000 && recentLong >= earlierLong * 1.25) {
    traits.push({
      key: "builder",
      title: "The Long-Distance Builder",
      evidence: `Your longest run in the last 4 weeks (${km(recentLong)} km) is ${Math.round((recentLong / earlierLong - 1) * 100)}% longer than in the 4 weeks before (${km(earlierLong)} km).`,
    });
  }

  const runs = (xs: DnaActivity[]) =>
    xs.filter((a) => (a.type === "run" || a.type === "walk_run") && a.avgPace !== null);
  const avgPace = (xs: DnaActivity[]) => {
    const r = runs(xs);
    const dist = r.reduce((t, a) => t + a.distanceM, 0);
    return dist >= 3000 ? r.reduce((t, a) => t + a.avgPace! * a.distanceM, 0) / dist : null;
  };
  const recentPace = avgPace(acts.filter((a) => a.weeksAgo < 4));
  const earlierPace = avgPace(acts.filter((a) => a.weeksAgo >= 4 && a.weeksAgo < 8));
  if (recentPace !== null && earlierPace !== null && recentPace <= earlierPace * 0.97) {
    traits.push({
      key: "speed",
      title: "The Speed Chaser",
      evidence: `Your average running pace over the last 4 weeks is ${Math.round((1 - recentPace / earlierPace) * 100)}% faster than the 4 weeks before.`,
    });
  }

  const inactiveBefore = [3, 4, 5].every((w) => !acts.some((a) => a.weeksAgo === w));
  const activeNow = [0, 1, 2].filter((w) => acts.some((a) => a.weeksAgo === w)).length >= 2;
  const hadHistory = acts.some((a) => a.weeksAgo >= 6);
  if (inactiveBefore && activeNow && hadHistory) {
    traits.push({
      key: "comeback",
      title: "The Comeback Runner",
      evidence: "After three quiet weeks, you have been active in at least two of the last three.",
    });
  }

  const dist4 = acts.filter((a) => a.weeksAgo < 4).reduce((t, a) => t + a.distanceM, 0);
  const distPrev4 = acts.filter((a) => a.weeksAgo >= 4 && a.weeksAgo < 8).reduce((t, a) => t + a.distanceM, 0);
  let trend: string | null = null;
  if (distPrev4 >= 5000) {
    const change = Math.round((dist4 / distPrev4 - 1) * 100);
    trend =
      Math.abs(change) < 5
        ? `Your distance over the last 4 weeks (${km(dist4)} km) is about the same as the 4 weeks before.`
        : `Your distance over the last 4 weeks (${km(dist4)} km) is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than the 4 weeks before (${km(distPrev4)} km).`;
  }
  return { traits, trend, enoughData: true };
}
