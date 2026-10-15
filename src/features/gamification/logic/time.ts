/**
 * Local-calendar helpers. Every streak, reward and report works on local
 * calendar days ("YYYY-MM-DD") in the runner's timezone (default
 * Asia/Kolkata), never on UTC dates, so a 06:00 IST run counts for the
 * right day. Plain date strings keep the maths DST-safe.
 */
import { DEFAULT_TIMEZONE } from "@/lib/contracts";

export type LocalDate = string; // YYYY-MM-DD

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function parts(instant: string | Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) out[p.type] = p.value;
  return out;
}

/** Local calendar date of an instant. */
export function localDate(instant: string | Date, timeZone = DEFAULT_TIMEZONE): LocalDate {
  const p = parts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local hour (0–23) of an instant. */
export function localHour(instant: string | Date, timeZone = DEFAULT_TIMEZONE): number {
  return Number(parts(instant, timeZone).hour);
}

const toUtc = (d: LocalDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromUtc = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(d) + n * DAY);
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function weekday(d: LocalDate): number {
  const js = new Date(toUtc(d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Monday of the ISO week containing `d`. */
export function weekStart(d: LocalDate): LocalDate {
  return addDays(d, 1 - weekday(d));
}

export function monthStart(d: LocalDate): LocalDate {
  return `${d.slice(0, 7)}-01`;
}

export function yearStart(d: LocalDate): LocalDate {
  return `${d.slice(0, 4)}-01-01`;
}

export function addMonths(d: LocalDate, n: number): LocalDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  return fromUtc(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC instant at local midnight of `d` (for database range queries). */
export function localMidnightUtc(d: LocalDate, timeZone = DEFAULT_TIMEZONE): Date {
  // Offset of the zone at that date (minutes matter: IST is +05:30).
  const guess = new Date(toUtc(d));
  const p = parts(guess, timeZone);
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const offset = shown - guess.getTime();
  return new Date(guess.getTime() - offset);
}
