import { TZDate } from "@date-fns/tz";
import { DEFAULT_TIMEZONE } from "@/lib/contracts";

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function localDateTimeToIso(value: string, timeZone = DEFAULT_TIMEZONE) {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const zoned = new TZDate(year, month - 1, day, hour, minute, timeZone);
  if (Number.isNaN(zoned.getTime())) return null;
  return zoned.toISOString();
}

export function isoToLocalInput(iso: string, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

export function isUnread(publishAt: string, readAt: string | null, now = Date.now()) {
  if (new Date(publishAt).getTime() > now) return false;
  return readAt === null;
}
