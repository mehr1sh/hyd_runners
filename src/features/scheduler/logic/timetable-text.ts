import { fromMinutes } from "./time";
import type { AvailabilityDraft } from "./types";

/**
 * Deterministic parser for text extracted from a timetable PDF. It is the
 * fallback when no AI provider is configured, and the first pass when one is.
 *
 * It never guesses. When a value cannot be read with confidence it is left
 * null and the reason is recorded in `uncertainties`, so the review screen
 * can ask the runner. Rules:
 *
 * - Day names (Mon, Monday, Tue, Tues, …) set the day for that line. A line
 *   with only day names (a heading) sets the day for the following lines.
 *   Day ranges such as "Mon-Fri" and lists such as "Mon, Wed" expand.
 * - A line naming three or more days and no times is treated as a grid
 *   header. PDF text loses column positions, so following rows get no day.
 * - Times: "09:00", "9.30", "9am", "2:15 pm". A time with AM/PM, a leading
 *   zero, or an hour of 0 or 13–23 is unambiguous. Hours 8–12 without AM/PM
 *   are read as written (morning / noon); they are flagged for checking
 *   unless the document already uses the 24-hour clock elsewhere (a time
 *   like "08:00" or "14:00"). Hours 1–7 without AM/PM are always ambiguous
 *   and left empty.
 * - In a range where only one side has AM/PM ("2-3pm"), the other side
 *   shares it, unless that would put the start after the end ("11-1pm").
 * - Entries are `busy` (classes, work) unless the line says free/available.
 * - Lines with a calendar date are one-off events; the contract only stores
 *   weekly repeating blocks, so they are flagged rather than dropped.
 */

export type ParsedTimetable = {
  drafts: AvailabilityDraft[];
  status: "complete" | "partial" | "empty";
  notes: string[];
  stats: { lines: number; timeLikeLines: number; rows: number; uncertainRows: number; unreadLines: number };
};

const DAY_WORDS: Array<[RegExp, number]> = [
  [/^mon(day)?$/i, 1],
  [/^tue(s|sday)?$/i, 2],
  [/^wed(s|nesday)?$/i, 3],
  [/^thu(r|rs|rsday)?$/i, 4],
  [/^fri(day)?$/i, 5],
  [/^sat(urday)?$/i, 6],
  [/^sun(day)?$/i, 7],
];
const DAY_TOKEN =
  "(?:mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const DAY_RANGE_RE = new RegExp(`\\b(${DAY_TOKEN})\\s*(?:-|–|—|to)\\s*(${DAY_TOKEN})\\b`, "gi");
const DAY_RE = new RegExp(`\\b(${DAY_TOKEN})\\b`, "gi");

const MER = "(a\\.?m\\.?|p\\.?m\\.?)";
const TIME = `(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MER}?`;
const RANGE_RE = new RegExp(`(?<![\\d/:.])${TIME}\\s*(?:-|–|—|to|until|till)\\s*${TIME}(?![\\d/])`, "gi");
const SINGLE_RE = /(?<![\d/:.])(\d{1,2})(?:[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?|\s*(a\.?m\.?|p\.?m\.?))(?![\d/])/gi;
const DATE_RE =
  /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi;
const FREE_RE = /\b(free|available|availability|open slot)\b/i;

function dayNumber(word: string): number | null {
  for (const [re, n] of DAY_WORDS) if (re.test(word)) return n;
  return null;
}

type Resolved = { minutes: number | null; assumed: boolean; reason: string | null };

function meridiem(raw: string | undefined): "am" | "pm" | null {
  if (!raw) return null;
  return raw.toLowerCase().startsWith("p") ? "pm" : "am";
}

function resolveTime(
  hourText: string,
  minuteText: string | undefined,
  mer: "am" | "pm" | null,
  uses24h = false,
): Resolved {
  const h = Number(hourText);
  const m = minuteText === undefined ? 0 : Number(minuteText);
  const shown = `${hourText}${minuteText !== undefined ? `:${minuteText}` : ""}`;
  if (m > 59) return { minutes: null, assumed: false, reason: `“${shown}” is not a valid time.` };
  if (mer) {
    if (h < 1 || h > 12) return { minutes: null, assumed: false, reason: `“${shown} ${mer}” is not a valid time.` };
    const hour = mer === "pm" ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    return { minutes: hour * 60 + m, assumed: false, reason: null };
  }
  if (h > 23) return { minutes: null, assumed: false, reason: `“${shown}” is not a valid time.` };
  if (h === 0 || h >= 13 || (hourText.length === 2 && hourText.startsWith("0"))) {
    return { minutes: h * 60 + m, assumed: false, reason: null };
  }
  if (h >= 8) {
    if (uses24h) return { minutes: h * 60 + m, assumed: false, reason: null };
    return {
      minutes: h * 60 + m,
      assumed: true,
      reason: `“${shown}” has no AM/PM; read as ${fromMinutes(h * 60 + m)}. Check it.`,
    };
  }
  return { minutes: null, assumed: false, reason: `Could not tell whether “${shown}” is AM or PM.` };
}

function daysInLine(line: string): number[] {
  const days = new Set<number>();
  let rest = line;
  for (const match of line.matchAll(DAY_RANGE_RE)) {
    const a = dayNumber(match[1]);
    const b = dayNumber(match[2]);
    if (a && b && a <= b) for (let d = a; d <= b; d++) days.add(d);
    rest = rest.replace(match[0], " ");
  }
  for (const match of rest.matchAll(DAY_RE)) {
    const d = dayNumber(match[1]);
    if (d) days.add(d);
  }
  return [...days].sort((x, y) => x - y);
}

function cleanLabel(text: string): string | null {
  const label = text
    .replace(/[|•·,;]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim();
  if (!label || !/[a-z]/i.test(label)) return null;
  return label.slice(0, 80);
}

export function parseTimetableText(text: string, makeKey: () => string): ParsedTimetable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const uses24h = /(?<![\d:.])(0\d|1[3-9]|2[0-3])[:.][0-5]\d(?!\s*[ap]\.?m)/i.test(text);
  const resolve = (h: string, m: string | undefined, mer: "am" | "pm" | null) => resolveTime(h, m, mer, uses24h);
  const drafts: AvailabilityDraft[] = [];
  const notes: string[] = [];
  let contextDays: number[] = [];
  let gridHeaderSeen = false;
  let timeLikeLines = 0;
  let unreadLines = 0;

  for (const line of lines) {
    const dates = [...line.matchAll(DATE_RE)].map((m) => m[0]);
    let work = dates.reduce((acc, d) => acc.replace(d, " "), line);

    const days = daysInLine(work);
    const ranges = [...work.matchAll(RANGE_RE)];
    for (const r of ranges) work = work.replace(r[0], " ");
    const singles = [...work.matchAll(SINGLE_RE)];
    for (const s of singles) work = work.replace(s[0], " ");
    const hasTimes = ranges.length > 0 || singles.length > 0;

    if (!hasTimes) {
      if (days.length >= 3 && !/\d/.test(work.replace(DAY_RE, ""))) {
        gridHeaderSeen = true;
        contextDays = [];
      } else if (days.length > 0) {
        contextDays = days;
        gridHeaderSeen = false;
      }
      if (/\d{1,2}\s*[:.]\s*\d{2}/.test(line)) {
        timeLikeLines++;
        unreadLines++;
      }
      continue;
    }

    timeLikeLines++;
    const sameLineDays = days.length > 0;
    if (sameLineDays) contextDays = days;
    const lineDays = sameLineDays ? days : contextDays;
    const label = cleanLabel(work.replace(DAY_RANGE_RE, " ").replace(DAY_RE, " "));
    const kind = FREE_RE.test(line) ? "free" : "busy";

    const entries: Array<{ start: Resolved; end: Resolved | null; raw: string }> = [];
    for (const r of ranges) {
      let startMer = meridiem(r[3]);
      let endMer = meridiem(r[6]);
      if (!startMer && endMer) {
        startMer = endMer;
        const trial = resolve(r[1], r[2], startMer);
        const end = resolve(r[4], r[5], endMer);
        if (trial.minutes !== null && end.minutes !== null && trial.minutes >= end.minutes) startMer = "am";
      } else if (startMer && !endMer) {
        endMer = startMer;
        const start = resolve(r[1], r[2], startMer);
        const trial = resolve(r[4], r[5], endMer);
        if (start.minutes !== null && trial.minutes !== null && trial.minutes <= start.minutes) endMer = "pm";
      }
      entries.push({ start: resolve(r[1], r[2], startMer), end: resolve(r[4], r[5], endMer), raw: r[0] });
    }
    for (const s of singles) {
      entries.push({ start: resolve(s[1], s[2], meridiem(s[3] ?? s[4])), end: null, raw: s[0] });
    }

    for (const entry of entries) {
      const uncertainties: string[] = [];
      let confidence = 0.9;
      if (entry.start.reason) uncertainties.push(entry.start.reason);
      if (entry.end?.reason) uncertainties.push(entry.end.reason);
      if (entry.start.assumed || entry.end?.assumed) confidence -= 0.3;
      if (entry.end === null) uncertainties.push("No end time found.");

      let startTime = entry.start.minutes === null ? null : fromMinutes(entry.start.minutes);
      let endTime = entry.end?.minutes == null ? null : fromMinutes(entry.end.minutes);
      if (startTime && endTime && entry.end!.minutes! <= entry.start.minutes!) {
        uncertainties.push(`“${entry.raw.trim()}” ends before it starts; times were left empty.`);
        startTime = null;
        endTime = null;
      }
      if (startTime === null || endTime === null) confidence = Math.min(confidence, 0.3);

      if (dates.length > 0) {
        uncertainties.push(
          `Mentions a date (${dates.join(", ")}). Only weekly repeating times are stored; keep this row only if it repeats every week.`,
        );
        confidence = Math.min(confidence, 0.3);
      }

      let targetDays: Array<number | null> = lineDays;
      if (lineDays.length === 0) {
        uncertainties.push(
          gridHeaderSeen
            ? "The day could not be matched to this time (grid layouts lose their columns in PDF text)."
            : "No day of the week found for this time.",
        );
        confidence = Math.min(confidence, 0.3);
        targetDays = [null];
      } else if (!sameLineDays) {
        confidence -= 0.1;
      }

      for (const weekday of targetDays) {
        drafts.push({
          key: makeKey(),
          weekday,
          startTime,
          endTime,
          kind,
          label,
          source: "text_parser",
          confidence: Math.max(0, Math.round(confidence * 100) / 100),
          uncertainties: [...uncertainties],
          rawText: line.slice(0, 200),
          confirmed: false,
        });
      }
    }
  }

  if (unreadLines > 0) {
    notes.push(
      `${unreadLines} line${unreadLines === 1 ? "" : "s"} looked like ${unreadLines === 1 ? "it" : "they"} contained times but could not be read. Add anything missing by hand.`,
    );
  }
  if (gridHeaderSeen) {
    notes.push("This looks like a grid timetable. Check that every row has the right day.");
  }
  if (drafts.length > 0 && !drafts.some((d) => d.kind === "free")) {
    notes.push(
      "The timetable lists busy times only. It does not say when you are free, so confirm your free time before planning.",
    );
  }

  const uncertainRows = drafts.filter((d) => d.uncertainties.length > 0).length;
  const status = drafts.length === 0 ? "empty" : uncertainRows > 0 || unreadLines > 0 ? "partial" : "complete";
  return {
    drafts,
    status,
    notes,
    stats: { lines: lines.length, timeLikeLines, rows: drafts.length, uncertainRows, unreadLines },
  };
}
