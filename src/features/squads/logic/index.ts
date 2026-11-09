/**
 * Coarse Hyderabad running areas for matching. Matching never uses
 * coordinates; runners choose up to five of these neighbourhoods.
 */
export const AREAS = {
  banjara_hills: "Banjara Hills",
  jubilee_hills: "Jubilee Hills (KBR Park)",
  gachibowli: "Gachibowli",
  madhapur_hitec_city: "Madhapur / HITEC City",
  kondapur: "Kondapur",
  kukatpally: "Kukatpally",
  miyapur: "Miyapur",
  manikonda: "Manikonda / Narsingi",
  begumpet: "Begumpet",
  secunderabad: "Secunderabad",
  ameerpet: "Ameerpet",
  necklace_road: "Necklace Road / Tank Bund",
  old_city: "Old City",
  uppal: "Uppal",
  lb_nagar: "LB Nagar / Dilsukhnagar",
  kompally: "Kompally",
  tarnaka: "Tarnaka / Osmania University",
  mehdipatnam: "Mehdipatnam",
  shamshabad: "Shamshabad",
  other: "Elsewhere in Hyderabad",
} as const;
export type Area = keyof typeof AREAS;

export const GOALS = {
  consistency: "Run consistently",
  faster: "Get faster",
  longer: "Run longer",
  race: "Train for a race",
  social: "Meet people",
  beginner_friendly: "Beginner-friendly company",
} as const;

export type SquadWeek = { weekStart: string; km: number; activeMembers: number };

/** Consecutive completed weeks (most recent first, excluding the current week) that hit the target. */
export function targetStreak(weeks: SquadWeek[], target: number | null) {
  if (!target) return 0;
  const done = weeks.slice(0, -1).reverse();
  let n = 0;
  for (const w of done) {
    if (w.km >= target) n++;
    else break;
  }
  return n;
}

export type Achievement = { key: string; title: string; detail: string };

/**
 * Shared achievements computed from the squad's own weekly totals. Nothing
 * is stored, so they can't be duplicated or claimed without the data.
 */
export function squadAchievements(weeks: SquadWeek[], target: number | null, memberCount: number): Achievement[] {
  const out: Achievement[] = [];
  const done = weeks.slice(0, -1);
  const total = weeks.reduce((s, w) => s + w.km, 0);
  if (target && done.some((w) => w.km >= target))
    out.push({ key: "first_target", title: "Target hit", detail: `Reached the ${target} km weekly target together.` });
  const streak = targetStreak(weeks, target);
  if (streak >= 4) out.push({ key: "streak4", title: "Four in a row", detail: `${streak} weeks in a row on target.` });
  if (total >= 100)
    out.push({ key: "km100", title: "100 km together", detail: `${Math.round(total)} km in the last nine weeks.` });
  if (memberCount >= 2 && done.some((w) => w.activeMembers >= memberCount))
    out.push({ key: "all_in", title: "All in", detail: "Every member ran in the same week." });
  return out;
}
