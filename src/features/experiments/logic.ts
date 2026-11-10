/**
 * Experimental running experiences: pure helpers.
 */

export type SplitLike = { index: number; seconds: number; partial?: boolean };

/**
 * Ghost Runner: cumulative time at each full kilometre for this run and an
 * earlier run on a matched route. Only kilometres both runs completed are
 * compared; negative delta means ahead of the ghost.
 */
export function ghostComparison(current: SplitLike[], ghost: SplitLike[]) {
  const full = (s: SplitLike[]) => s.filter((x) => !x.partial).sort((a, b) => a.index - b.index);
  const a = full(current);
  const b = full(ghost);
  const n = Math.min(a.length, b.length);
  let ca = 0;
  let cb = 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    ca += a[i].seconds;
    cb += b[i].seconds;
    rows.push({ km: a[i].index, current: ca, ghost: cb, delta: ca - cb, splitDelta: a[i].seconds - b[i].seconds });
  }
  return { rows, final: rows.at(-1)?.delta ?? null };
}

/**
 * Virtual relays: a squad's real combined distance plotted on a simulated
 * journey. Distances are approximate road distances, shown as such; nobody
 * travels anywhere.
 */
export const JOURNEYS = {
  hyd_vizag: {
    name: "Hyderabad to Visakhapatnam",
    km: 620,
    checkpoints: [
      { at: 145, name: "Suryapet" },
      { at: 275, name: "Vijayawada" },
      { at: 420, name: "Rajahmundry" },
      { at: 620, name: "Visakhapatnam" },
    ],
  },
  hyd_bengaluru: {
    name: "Hyderabad to Bengaluru",
    km: 575,
    checkpoints: [
      { at: 215, name: "Kurnool" },
      { at: 360, name: "Anantapur" },
      { at: 575, name: "Bengaluru" },
    ],
  },
  hyd_mumbai: {
    name: "Hyderabad to Mumbai",
    km: 710,
    checkpoints: [
      { at: 300, name: "Solapur" },
      { at: 560, name: "Pune" },
      { at: 710, name: "Mumbai" },
    ],
  },
  golden_quadrilateral: {
    name: "The Golden Quadrilateral",
    km: 5846,
    checkpoints: [
      { at: 1450, name: "Delhi to Kolkata" },
      { at: 3130, name: "Kolkata to Chennai" },
      { at: 4420, name: "Chennai to Mumbai" },
      { at: 5846, name: "Mumbai to Delhi" },
    ],
  },
  around_the_world: {
    name: "Around the world (equator)",
    km: 40075,
    checkpoints: [
      { at: 10019, name: "A quarter of the way" },
      { at: 20038, name: "Halfway" },
      { at: 40075, name: "All the way round" },
    ],
  },
} as const;
export type JourneyKey = keyof typeof JOURNEYS;

export function relayStatus(journey: JourneyKey, km: number) {
  const j = JOURNEYS[journey];
  const done = Math.min(km, j.km);
  const passed = j.checkpoints.filter((c) => c.at <= done);
  const next = j.checkpoints.find((c) => c.at > done) ?? null;
  return {
    pct: Math.round((done / j.km) * 1000) / 10,
    passed: passed.map((c) => c.name),
    next: next ? { name: next.name, kmToGo: Math.round((next.at - done) * 10) / 10 } : null,
    finished: km >= j.km,
  };
}

/** Run Roulette: a uniformly random pick from real routes (index from a random source). */
export function roulettePick<T>(routes: T[], random: number): T | null {
  if (routes.length === 0) return null;
  return routes[Math.min(routes.length - 1, Math.floor(random * routes.length))];
}
