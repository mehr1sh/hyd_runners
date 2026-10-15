/**
 * Levels and ranks. Level n starts at 50·n·(n−1) XP:
 * L1 0 · L2 100 · L3 300 · L4 600 · L5 1000 · … (each level needs 100·n more).
 */
export function xpThreshold(level: number): number {
  return 50 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpThreshold(level + 1) <= Math.max(0, xp)) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const start = xpThreshold(level);
  const next = xpThreshold(level + 1);
  return { level, xpIntoLevel: Math.max(0, xp) - start, xpForNextLevel: next - start, rank: rankForLevel(level) };
}

export const RANKS = [
  { minLevel: 15, name: "Pace setter" },
  { minLevel: 10, name: "Dedicated" },
  { minLevel: 6, name: "Committed" },
  { minLevel: 3, name: "Regular" },
  { minLevel: 1, name: "Rookie" },
] as const;

export function rankForLevel(level: number): string {
  return RANKS.find((r) => level >= r.minLevel)!.name;
}
