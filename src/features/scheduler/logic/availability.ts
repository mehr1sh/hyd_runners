import type { AvailabilityBlock } from "@/lib/contracts";
import { formatRange, fromMinutes, isLocalTime, toMinutes, weekdayName } from "./time";
import type { AvailabilityDraft, AvailabilityIssue } from "./types";

/**
 * Availability rules:
 *
 * - A block is a recurring weekly period: weekday + local start/end time. It
 *   cannot cross midnight (the contract requires end > start), so an overnight
 *   period is entered as two rows.
 * - `free` blocks are the only time the scheduler may use. Time that no block
 *   mentions is never assumed to be free.
 * - `busy` blocks always win: free time that overlaps busy time is removed.
 *   That overlap is reported as a warning, not silently ignored.
 * - Two blocks of the same kind that overlap are an error: the runner must
 *   merge or correct them, so a typo cannot quietly widen their free time.
 */

export type Interval = { start: number; end: number };

export type ValidBlock = Pick<
  AvailabilityBlock,
  "weekday" | "startTime" | "endTime" | "kind" | "label" | "source" | "confidence"
> & { draftIndex: number };

export const MIN_FREE_BLOCK_MINUTES = 10;

/** Label of rows created by `deriveFreeFromBusy`; they need the same check as extracted rows. */
export const GAP_LABEL = "Gap between busy times";

export function validateAvailability(
  drafts: readonly AvailabilityDraft[],
  options: { requireConfirmed?: boolean; requireFreeTime?: boolean } = {},
): { issues: AvailabilityIssue[]; blocks: ValidBlock[]; ok: boolean } {
  const issues: AvailabilityIssue[] = [];
  const blocks: ValidBlock[] = [];

  drafts.forEach((d, index) => {
    const where = d.weekday ? weekdayName(d.weekday) : `Row ${index + 1}`;
    let complete = true;
    if (d.weekday === null) {
      complete = false;
      issues.push({
        index,
        field: "weekday",
        code: "missing_weekday",
        severity: "error",
        message: `Row ${index + 1}: choose the day of the week.`,
      });
    }
    if (d.startTime === null || !isLocalTime(d.startTime)) {
      complete = false;
      issues.push({
        index,
        field: "startTime",
        code: "missing_start",
        severity: "error",
        message: `${where}: enter a start time (24-hour HH:mm).`,
      });
    }
    if (d.endTime === null || !isLocalTime(d.endTime)) {
      complete = false;
      issues.push({
        index,
        field: "endTime",
        code: "missing_end",
        severity: "error",
        message: `${where}: enter an end time (24-hour HH:mm).`,
      });
    }
    if (options.requireConfirmed && !d.confirmed) {
      issues.push({
        index,
        field: "confirmed",
        code: "unconfirmed",
        severity: "error",
        message: `${where}: check this extracted row and mark it as correct, or delete it.`,
      });
    }
    if (!complete) return;

    const start = toMinutes(d.startTime!);
    const end = toMinutes(d.endTime!);
    if (end <= start) {
      issues.push({
        index,
        field: "endTime",
        code: "end_before_start",
        severity: "error",
        message: `${where} ${d.startTime}–${d.endTime}: the end must be after the start. For time past midnight, add two rows (e.g. 22:00–23:59 and 00:00–01:00 the next day).`,
      });
      return;
    }
    if (d.kind === "free" && end - start < MIN_FREE_BLOCK_MINUTES) {
      issues.push({
        index,
        field: "endTime",
        code: "too_short",
        severity: "warning",
        message: `${where} ${d.startTime}–${d.endTime} is shorter than ${MIN_FREE_BLOCK_MINUTES} minutes, so no session can use it.`,
      });
    }
    blocks.push({
      weekday: d.weekday!,
      startTime: d.startTime!,
      endTime: d.endTime!,
      kind: d.kind,
      label: d.label,
      source: d.source,
      confidence: d.confidence,
      draftIndex: index,
    });
  });

  // Overlap checks, per day. Sorting keeps messages in a predictable order.
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = blocks
      .filter((b) => b.weekday === weekday)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || a.draftIndex - b.draftIndex);
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        const a = day[i];
        const b = day[j];
        if (toMinutes(b.startTime) >= toMinutes(a.endTime)) continue;
        if (a.kind === b.kind) {
          issues.push({
            index: b.draftIndex,
            field: "startTime",
            code: "overlap_same_kind",
            severity: "error",
            message: `${weekdayName(weekday)}: ${a.kind} time ${a.startTime}–${a.endTime} overlaps ${b.startTime}–${b.endTime}. Merge them into one row or correct the times.`,
          });
        } else {
          const free = a.kind === "free" ? a : b;
          const busy = a.kind === "busy" ? a : b;
          issues.push({
            index: free.draftIndex,
            field: "startTime",
            code: "free_overlaps_busy",
            severity: "warning",
            message: `${weekdayName(weekday)}: free time ${free.startTime}–${free.endTime} overlaps busy time ${busy.startTime}–${busy.endTime}${busy.label ? ` (${busy.label})` : ""}. Busy time wins, so the overlap will not be used.`,
          });
        }
      }
    }
  }

  if (options.requireFreeTime) {
    const free = freeIntervals(blocks);
    const total = Object.values(free)
      .flat()
      .reduce((sum, i) => sum + (i.end - i.start), 0);
    if (total === 0) {
      issues.push({
        index: null,
        field: null,
        code: "no_free_time",
        severity: "error",
        message:
          "There is no confirmed free time yet. Add the periods when you could train, or use “fill gaps between busy times” and check the result.",
      });
    }
  }

  return { issues, blocks, ok: !issues.some((i) => i.severity === "error") };
}

/** Merge overlapping or touching intervals. Input order does not matter. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** `base` minus every interval in `remove`. */
export function subtractIntervals(base: readonly Interval[], remove: readonly Interval[]): Interval[] {
  let current = mergeIntervals(base);
  for (const r of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const i of current) {
      if (r.end <= i.start || r.start >= i.end) {
        next.push(i);
        continue;
      }
      if (r.start > i.start) next.push({ start: i.start, end: r.start });
      if (r.end < i.end) next.push({ start: r.end, end: i.end });
    }
    current = next;
  }
  return current;
}

export type BlockLike = Pick<AvailabilityBlock, "weekday" | "startTime" | "endTime" | "kind">;

/** Usable free time per weekday (1–7): merged free blocks minus busy blocks. */
export function freeIntervals(blocks: readonly BlockLike[]): Record<number, Interval[]> {
  const result: Record<number, Interval[]> = {};
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = blocks.filter((b) => b.weekday === weekday);
    const toInterval = (b: BlockLike) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) });
    result[weekday] = subtractIntervals(
      day.filter((b) => b.kind === "free").map(toInterval),
      day.filter((b) => b.kind === "busy").map(toInterval),
    );
  }
  return result;
}

export function busyIntervals(blocks: readonly BlockLike[]): Record<number, Interval[]> {
  const result: Record<number, Interval[]> = {};
  for (let weekday = 1; weekday <= 7; weekday++) {
    result[weekday] = mergeIntervals(
      blocks
        .filter((b) => b.weekday === weekday && b.kind === "busy")
        .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
    );
  }
  return result;
}

/**
 * Explicit, opt-in convention: treat the gaps between busy blocks as free,
 * but only inside a daily window the runner chooses (e.g. 06:00–21:00) and only
 * on the days they pick. Returns new *unconfirmed* drafts for review; it never
 * changes existing rows.
 */
export function deriveFreeFromBusy(
  drafts: readonly AvailabilityDraft[],
  options: { weekdays: readonly number[]; from: string; to: string; minMinutes?: number; makeKey: () => string },
): AvailabilityDraft[] {
  const { blocks } = validateAvailability(drafts);
  const window = { start: toMinutes(options.from), end: toMinutes(options.to) };
  if (window.end <= window.start) return [];
  const minMinutes = options.minMinutes ?? 20;
  const busy = busyIntervals(blocks);
  const out: AvailabilityDraft[] = [];
  for (const weekday of [...options.weekdays].sort((a, b) => a - b)) {
    const alreadyFree = blocks
      .filter((b) => b.weekday === weekday && b.kind === "free")
      .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) }));
    const gaps = subtractIntervals([window], [...busy[weekday], ...alreadyFree]);
    for (const gap of gaps) {
      if (gap.end - gap.start < minMinutes) continue;
      out.push({
        key: options.makeKey(),
        weekday,
        startTime: fromMinutes(gap.start),
        endTime: fromMinutes(Math.min(gap.end, 23 * 60 + 59)),
        kind: "free",
        label: GAP_LABEL,
        source: "manual",
        confidence: null,
        uncertainties: [],
        rawText: null,
        confirmed: false,
      });
    }
  }
  return out;
}

export function describeInterval(weekday: number, i: Interval) {
  return `${weekdayName(weekday)} ${formatRange(i.start, i.end)}`;
}
