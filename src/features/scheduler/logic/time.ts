import { TZDate } from "@date-fns/tz";
import { LocalTime } from "@/lib/contracts";

/**
 * Wall-clock helpers. Recurring availability is `weekday + HH:mm` in the
 * runner's timezone; instants are UTC ISO strings. All
 * arithmetic on a recurring week happens in minutes since local midnight, so
 * no timezone conversion happens until a session is turned into an instant.
 */

export const MINUTES_PER_DAY = 24 * 60;

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function weekdayName(weekday: number) {
  return WEEKDAY_NAMES[weekday - 1] ?? `Day ${weekday}`;
}

export function weekdayShort(weekday: number) {
  return WEEKDAY_SHORT[weekday - 1] ?? `D${weekday}`;
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LocalTime.safeParse(value).success;
}

/** `"06:30"` → 390. Throws on malformed input; validate first with `isLocalTime`. */
export function toMinutes(time: string): number {
  if (!isLocalTime(time)) throw new Error(`Invalid local time: ${time}`);
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 390 → `"06:30"`. Only valid for 0 ≤ minutes < 1440. */
export function fromMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new Error(`Minutes out of range for a local time: ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatRange(startMinutes: number, endMinutes: number) {
  return `${fromMinutes(startMinutes)}–${fromMinutes(endMinutes)}`;
}

/** True when `date` (YYYY-MM-DD) is a Monday. Weeks start on ISO Monday. */
export function isMonday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

/** The Monday (YYYY-MM-DD) of the week containing `instant`, in `timezone`. */
export function weekStartFor(instant: Date, timezone: string): string {
  const local = new TZDate(instant.getTime(), timezone);
  const isoWeekday = ((local.getDay() + 6) % 7) + 1;
  const monday = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - (isoWeekday - 1), timezone);
  return formatDate(monday);
}

function formatDate(d: TZDate) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The calendar date (YYYY-MM-DD) of `weekday` in the week starting `weekStart`. */
export function dateForWeekday(weekStart: string, weekday: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + weekday - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * The UTC instant for a wall-clock time on a weekday of a given week, in the
 * runner's timezone. Uses @date-fns/tz so a future non-IST zone stays correct.
 */
export function localToInstant(weekStart: string, weekday: number, minutes: number, timezone: string): string {
  const [y, m, d] = dateForWeekday(weekStart, weekday).split("-").map(Number);
  const local = new TZDate(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, timezone);
  return new Date(local.getTime()).toISOString();
}

/** Inverse of `localToInstant`: weekday, minutes and week start of an instant in `timezone`. */
export function instantToLocal(instant: string, timezone: string) {
  const local = new TZDate(new Date(instant).getTime(), timezone);
  const weekday = ((local.getDay() + 6) % 7) + 1;
  return {
    weekday,
    minutes: local.getHours() * 60 + local.getMinutes(),
    date: formatDate(local),
    weekStart: weekStartFor(new Date(instant), timezone),
  };
}
