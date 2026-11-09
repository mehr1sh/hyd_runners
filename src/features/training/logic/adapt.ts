import { addDays, daysBetween, type LocalDate } from "@/features/gamification/logic/time";
import { QUALITY_KINDS, type WorkoutKind } from "./workouts";

/**
 * Proposed changes to the runner's schedule. Nothing here writes anything:
 * the result becomes a training proposal that the runner accepts (in full or
 * in part) or rejects.
 *
 * Principles:
 * - never make up missed training by adding volume or stacking hard days;
 * - an easy session doesn't need making up;
 * - a key session (long run or quality) may move to a nearby free day only if
 *   it keeps a day's gap from other hard sessions and the next long run;
 * - otherwise it is let go, and the plan continues.
 */

export type Session = {
  id: string;
  date: LocalDate;
  title: string;
  workoutType: string;
  minutes: number;
  /** From structured details when present; inferred from the title otherwise. */
  kind: WorkoutKind | "strength" | "race" | "other";
  startTime: string; // HH:mm local
};

export type Change =
  | { op: "mark_missed"; workout_id: string; label: string }
  | { op: "cancel"; workout_id: string; label: string }
  | { op: "shorten"; workout_id: string; duration_minutes: number; label: string }
  | {
      op: "add";
      title: string;
      workout_type: string;
      date: LocalDate;
      start_time: string;
      duration_minutes: number;
      rationale: string[];
      details: Record<string, unknown> | null;
      label: string;
    };

export type Proposal = { title: string; summary: string; reasons: string[]; changes: Change[] };

export function inferKind(title: string, workoutType: string): Session["kind"] {
  const t = title.toLowerCase();
  if (workoutType === "strength" || workoutType === "mobility" || workoutType === "conditioning") return "strength";
  if (t.startsWith("race")) return "race";
  if (t.includes("long")) return "long";
  if (t.includes("tempo")) return "tempo";
  if (t.includes("interval") || t.includes("faster running")) return "intervals";
  if (t.includes("hill")) return "hills";
  if (t.includes("progression")) return "progression";
  if (t.includes("recovery")) return "recovery";
  if (workoutType === "run" || workoutType === "walk_run") return "easy";
  return "other";
}

const isHard = (k: Session["kind"]) => k === "long" || k === "race" || (QUALITY_KINDS as readonly string[]).includes(k);

/** Missed-session recovery: what to do about one session that didn't happen. */
export function missedSessionProposal(missed: Session, upcoming: Session[], today: LocalDate): Proposal {
  const markMissed: Change = {
    op: "mark_missed",
    workout_id: missed.id,
    label: `Mark "${missed.title}" on ${missed.date} as missed`,
  };
  const reasons: string[] = [];

  if (missed.kind === "race") {
    return {
      title: `Missed: ${missed.title}`,
      summary: "Mark the race as missed. Your race goal and history are unchanged; you can set a new goal any time.",
      reasons: ["A race can't be rescheduled from here."],
      changes: [markMissed],
    };
  }

  if (!isHard(missed.kind)) {
    return {
      title: `Missed: ${missed.title}`,
      summary: "No need to make this up. Your next sessions stay as planned.",
      reasons: [
        "Easy sessions build fitness over weeks; one missed session makes little difference.",
        "Adding it elsewhere would mean more load later in the week.",
      ],
      changes: [markMissed],
    };
  }

  const byDate = (d: LocalDate) => upcoming.filter((s) => s.date === d);
  const hardOn = (d: LocalDate) => byDate(d).some((s) => isHard(s.kind));
  const nextLong =
    upcoming
      .filter((s) => s.kind === "long" || s.kind === "race")
      .map((s) => s.date)
      .sort()[0] ?? null;
  const nextRace = upcoming.find((s) => s.kind === "race")?.date ?? null;
  if (nextRace && daysBetween(today, nextRace) <= 7) {
    reasons.push("Your race is within a week, so extra hard work now would only add fatigue.");
    return {
      title: `Missed: ${missed.title}`,
      summary: "Let it go and stay fresh for the race.",
      reasons,
      changes: [markMissed],
    };
  }

  for (let offset = 0; offset <= 3; offset++) {
    const day = addDays(today, offset);
    if (hardOn(addDays(day, -1)) || hardOn(addDays(day, 1))) continue;
    if (nextLong && day !== nextLong && Math.abs(daysBetween(day, nextLong)) < (missed.kind === "long" ? 4 : 2))
      continue;
    const there = byDate(day);
    if (missed.kind === "long") {
      if (there.length > 0) continue;
      const minutes = Math.max(20, Math.round(missed.minutes * 0.8));
      return {
        title: `Move your long run to ${day}`,
        summary: `Run a slightly shorter long run (${minutes} min) on ${day}. Nothing else changes.`,
        reasons: [
          "The long run is the key endurance session of the week.",
          `${day} is free, with no hard session the day before or after.`,
          "It's shortened by a fifth because it's closer to your other sessions than planned.",
        ],
        changes: [
          markMissed,
          {
            op: "add",
            title: "Long run (moved)",
            workout_type: missed.workoutType,
            date: day,
            start_time: missed.startTime,
            duration_minutes: minutes,
            rationale: [`Moved from ${missed.date}.`],
            details: null,
            label: `Add a ${minutes} min long run on ${day}`,
          },
        ],
      };
    }
    // Quality: swap with an easy session that is already planned, so the week's load stays the same.
    const easy = there.find((s) => s.kind === "easy");
    if (easy) {
      return {
        title: `Swap your ${missed.title.toLowerCase()} into ${day}`,
        summary: `Replace the easy run on ${day} with the missed ${missed.title.toLowerCase()}. Your total sessions stay the same.`,
        reasons: [
          "Swapping instead of adding keeps your weekly load unchanged.",
          `${day} has no hard session the day before or after.`,
        ],
        changes: [
          markMissed,
          { op: "cancel", workout_id: easy.id, label: `Remove the easy run on ${day}` },
          {
            op: "add",
            title: `${missed.title} (moved)`,
            workout_type: missed.workoutType,
            date: day,
            start_time: easy.startTime,
            duration_minutes: missed.minutes,
            rationale: [`Moved from ${missed.date}, replacing an easy run.`],
            details: null,
            label: `Add the ${missed.title.toLowerCase()} on ${day}`,
          },
        ],
      };
    }
  }
  return {
    title: `Missed: ${missed.title}`,
    summary: "There's no safe nearby slot, so let this one go. Don't add the missed work to your next sessions.",
    reasons: [
      "Every nearby day is next to another hard session or your long run.",
      "Doubling up raises fatigue more than it adds fitness.",
    ],
    changes: [markMissed],
  };
}

export type AdherenceInput = {
  past14: { planned: number; completed: number; missed: number };
  upcoming7: Session[];
  /** Average self-reported fatigue (1–5) over the last 7 days, if any. */
  fatigue: number | null;
};

/**
 * Adaptive adjustment for the coming week. Proposes easing off when the last
 * two weeks went poorly or the runner reports high fatigue; returns null when
 * the plan should simply continue.
 */
export function adaptiveProposal(input: AdherenceInput): Proposal | null {
  const { planned, completed, missed } = input.past14;
  const due = planned;
  const rate = due > 0 ? completed / due : null;
  const reasons: string[] = [];
  if (rate !== null && due >= 3 && rate < 0.6)
    reasons.push(
      `You completed ${completed} of ${due} planned sessions in the last two weeks${missed ? ` (${missed} marked missed)` : ""}.`,
    );
  if (input.fatigue !== null && input.fatigue >= 4)
    reasons.push(`Your recovery journal shows high fatigue (${input.fatigue.toFixed(1)} of 5 on average this week).`);
  if (reasons.length === 0) return null;

  const changes: Change[] = [];
  for (const s of input.upcoming7) {
    if ((QUALITY_KINDS as readonly string[]).includes(s.kind)) {
      changes.push({
        op: "cancel",
        workout_id: s.id,
        label: `Replace ${s.title.toLowerCase()} on ${s.date} with an easy run`,
      });
      changes.push({
        op: "add",
        title: "Easy run",
        workout_type: s.workoutType,
        date: s.date,
        start_time: s.startTime,
        duration_minutes: Math.max(20, Math.round(s.minutes * 0.8)),
        rationale: ["Eased off by an adaptive adjustment."],
        details: null,
        label: `Add an easy ${Math.max(20, Math.round(s.minutes * 0.8))} min run on ${s.date}`,
      });
    } else if (s.kind === "long" && s.minutes > 30) {
      const minutes = Math.round(s.minutes * 0.8);
      changes.push({
        op: "shorten",
        workout_id: s.id,
        duration_minutes: minutes,
        label: `Shorten the long run on ${s.date} to ${minutes} min`,
      });
    }
  }
  if (changes.length === 0) return null;
  return {
    title: "Ease off this week",
    summary: "Swap hard sessions for easy runs and shorten the long run for one week, then pick the plan back up.",
    reasons: [...reasons, "Repeating an easier week usually beats pushing on when things aren't going to plan."],
    changes,
  };
}
