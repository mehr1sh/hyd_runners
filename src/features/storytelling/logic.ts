/**
 * Story suggestions built only from what the runner wrote and the activity's
 * recorded numbers. Nothing is invented: if an answer is empty, the sentence
 * that would use it is left out. No AI is involved.
 */

export type Reflection = { difficult: string; enjoyed: string; ranWith: string; achieved: string };
export type StoryStats = { km: string; time: string; type: string; date: string };

const clean = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "");
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function storySuggestions(r: Reflection, st: StoryStats): string[] {
  const d = clean(r.difficult);
  const e = clean(r.enjoyed);
  const w = clean(r.ranWith);
  const a = clean(r.achieved);
  const out: string[] = [];
  const head = `${st.km} ${st.type.toLowerCase()} in ${st.time}${w ? ` with ${w}` : ""}.`;
  out.push([head, e ? `Best bit: ${lower(e)}.` : "", d ? `Hardest part: ${lower(d)}.` : ""].filter(Boolean).join(" "));
  if (a) out.push(`${a}. ${st.km} on ${st.date}${w ? `, with ${w}` : ""}.`);
  if (d && e) out.push(`${d} made it tough, but ${lower(e)} made it worth it. ${st.km}, ${st.time}.`);
  return [...new Set(out)].filter((s) => s.length > 0);
}

export type YearActivity = { startedAt: string; distanceM: number; movingS: number; type: string };

/** Weeks with at least one activity, and the longest run of consecutive active weeks. */
export function consistency(dates: string[]) {
  const weeks = [...new Set(dates.map((d) => weekKey(d)))].sort();
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const w of weeks) {
    cur = prev && nextWeek(prev) === w ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = w;
  }
  return { activeWeeks: weeks.length, longestWeekStreak: best };
}

function weekKey(isoDate: string) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
function nextWeek(w: string) {
  const d = new Date(`${w}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
