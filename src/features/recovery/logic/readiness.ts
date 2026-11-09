import { addDays, type LocalDate } from "@/features/gamification/logic/time";

/**
 * Readiness overview. Deliberately not a score: there is no validated way to
 * turn these inputs into one number. Each signal is shown with where it came
 * from (measured from activities, self-reported in the journal, or estimated
 * from both), and the suggestion lists the inputs that triggered it.
 * This is training guidance, not a medical assessment.
 */

export type Entry = {
  date: LocalDate;
  sleepQuality: number | null;
  sleepHours: number | null;
  fatigue: number | null;
  soreness: number | null;
  stress: number | null;
  energy: number | null;
  workoutRpe: number | null;
};

export type DayLoad = { date: LocalDate; runMinutes: number; strengthMinutes: number };

export type Signal = {
  key: string;
  label: string;
  value: string;
  source: "measured" | "self_reported" | "estimated";
  note?: string;
};

export type SuggestionKind = "rest" | "easy" | "reduced" | "mobility" | "strength" | "as_planned";

export type Readiness = {
  signals: Signal[];
  suggestion: { kind: SuggestionKind; title: string; detail: string; because: string[] };
  missing: string[];
};

export const SUGGESTION_TITLE: Record<SuggestionKind, string> = {
  rest: "Rest day",
  easy: "Easy day",
  reduced: "Reduce intensity",
  mobility: "Mobility session",
  strength: "Strength session",
  as_planned: "Continue as planned",
};

const SOURCE_LABEL = { measured: "Measured", self_reported: "Self-reported", estimated: "Estimated" } as const;
export const sourceLabel = (s: Signal["source"]) => SOURCE_LABEL[s];

/** Days with any activity, counting back from today (or yesterday if today is empty). */
export function consecutiveActiveDays(loads: DayLoad[], today: LocalDate) {
  const active = new Set(loads.filter((l) => l.runMinutes + l.strengthMinutes > 0).map((l) => l.date));
  let start = active.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (active.has(start)) {
    n++;
    start = addDays(start, -1);
  }
  return n;
}

export function readiness(loads: DayLoad[], entries: Entry[], today: LocalDate): Readiness {
  const signals: Signal[] = [];
  const missing: string[] = [];
  const inRange = (d: LocalDate, from: number, to: number) => d >= addDays(today, -from) && d <= addDays(today, -to);
  const minutes = (l: DayLoad) => l.runMinutes + l.strengthMinutes;
  const last7 = loads.filter((l) => inRange(l.date, 6, 0)).reduce((s, l) => s + minutes(l), 0);
  const prior21 = loads.filter((l) => inRange(l.date, 27, 7)).reduce((s, l) => s + minutes(l), 0);
  const priorWeekly = prior21 / 3;
  const activeDays7 = new Set(loads.filter((l) => inRange(l.date, 6, 0) && minutes(l) > 0).map((l) => l.date)).size;
  const restDays = 7 - activeDays7;
  const strength7 = loads.filter((l) => inRange(l.date, 6, 0) && l.strengthMinutes > 0).length;
  const streak = consecutiveActiveDays(loads, today);

  signals.push({
    key: "minutes7",
    label: "Training time, last 7 days",
    value: `${Math.round(last7)} min`,
    source: "measured",
  });
  signals.push({ key: "rest7", label: "Rest days, last 7 days", value: String(restDays), source: "measured" });
  if (priorWeekly > 0) {
    const ratio = last7 / priorWeekly;
    signals.push({
      key: "load_change",
      label: "This week against your previous three",
      value: `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}%`,
      source: "estimated",
      note: "Training time only; it doesn't know how hard sessions felt.",
    });
  } else missing.push("Three earlier weeks of activities, to compare this week's load.");

  const latest =
    [...entries].sort((a, b) => b.date.localeCompare(a.date)).find((e) => e.date >= addDays(today, -1)) ?? null;
  if (latest) {
    const add = (key: string, label: string, v: number | null, unit = " of 5") =>
      v !== null &&
      signals.push({ key, label, value: `${v}${unit}`, source: "self_reported", note: `Logged for ${latest.date}` });
    add("fatigue", "Fatigue", latest.fatigue);
    add("soreness", "Muscle soreness", latest.soreness);
    add("sleep_quality", "Sleep quality", latest.sleepQuality);
    if (latest.sleepHours !== null) add("sleep_hours", "Sleep", latest.sleepHours, " h");
    add("energy", "Energy", latest.energy);
    add("stress", "Stress", latest.stress);
  } else missing.push("A journal entry for today or yesterday (sleep, fatigue, soreness).");

  const because: string[] = [];
  let kind: SuggestionKind = "as_planned";
  const f = latest?.fatigue ?? null;
  const so = latest?.soreness ?? null;
  const sq = latest?.sleepQuality ?? null;
  const sh = latest?.sleepHours ?? null;

  if ((f !== null && f >= 4) || (so !== null && so >= 4)) {
    kind = "rest";
    if (f !== null && f >= 4) because.push(`You rated fatigue ${f} of 5.`);
    if (so !== null && so >= 4) because.push(`You rated soreness ${so} of 5.`);
  } else if (streak >= 6) {
    kind = "rest";
    because.push(`You've trained ${streak} days in a row.`);
  } else if ((sq !== null && sq <= 2) || (sh !== null && sh < 5.5)) {
    kind = "reduced";
    if (sq !== null && sq <= 2) because.push(`You rated sleep quality ${sq} of 5.`);
    if (sh !== null && sh < 5.5) because.push(`You logged ${sh} hours of sleep.`);
  } else if (priorWeekly > 0 && last7 > priorWeekly * 1.3) {
    kind = "easy";
    because.push(
      `This week's training time is ${Math.round((last7 / priorWeekly - 1) * 100)}% above your previous three-week average.`,
    );
  } else if (restDays === 0) {
    kind = "mobility";
    because.push("You haven't had a rest day in the last 7 days.");
  } else if (strength7 === 0 && restDays >= 2 && activeDays7 > 0) {
    kind = "strength";
    because.push("No strength session in the last 7 days, and you've had rest days.");
  } else {
    because.push("Nothing in your recent training or journal suggests changing your plan.");
  }

  const DETAIL: Record<SuggestionKind, string> = {
    rest: "Take a rest day or a gentle walk. If soreness is sharp, localised or getting worse, see a physiotherapist.",
    easy: "Keep today easy and conversational, or cross-train.",
    reduced: "Swap any hard session for an easy one today.",
    mobility: "A 15–20 minute mobility session instead of a run, or before an easy one.",
    strength: "A 20–30 minute strength session for hips, glutes and calves.",
    as_planned: "Train as planned, and ease off if you feel unusually tired.",
  };
  return { signals, suggestion: { kind, title: SUGGESTION_TITLE[kind], detail: DETAIL[kind], because }, missing };
}
