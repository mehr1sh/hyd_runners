import { z } from "zod";
import { AiProviderError, type AiFailureKind, type StructuredGenerator } from "@/lib/ai/structured";
import { freeIntervals, type BlockLike } from "../logic/availability";
import { buildSessionPlan, RECOVERY_RULES } from "../logic/programme";
import { planWeek, type PlanWeekOutput } from "../logic/schedule";
import { formatRange, weekdayName } from "../logic/time";
import type { PlannerSettings, ProposedSession, WeeklyProposal } from "../logic/types";
import { validateSchedule } from "../logic/validate-schedule";

/**
 * Proposal generation: the deterministic plan first, then an optional AI pass.
 *
 * The AI may only rearrange the sessions the app already chose (by key) and
 * add wording. It cannot add sessions, change workout types or durations
 * beyond the runner's limit, or relax any rule: its output goes through the
 * same `validateSchedule` as everything else, and anything that fails is
 * discarded in favour of the deterministic plan. Without AI the result is
 * the deterministic plan, unchanged.
 */

export type AiOutcome = {
  status: "not_configured" | "not_requested" | "rate_limited" | "used" | "failed" | "rejected";
  /** Safe to show to the runner. */
  message: string | null;
  kind?: AiFailureKind;
  latencyMs?: number;
};

export const AiScheduleSuggestion = z.object({
  sessions: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        weekday: z.number().int().min(1).max(7),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        durationMinutes: z.number().int().min(5).max(300),
        note: z.string().max(240),
      }),
    )
    .max(7),
  summary: z.string().max(600),
  alternatives: z.array(z.string().max(200)).max(4),
});
export type AiScheduleSuggestion = z.infer<typeof AiScheduleSuggestion>;

const SYSTEM_PROMPT = `You help beginner runners in Hyderabad arrange a weekly training plan around their timetable.

You receive the runner's confirmed free time, their preferences, the recovery rules, the sessions to arrange (each with a key) and a valid baseline plan.
Return an arrangement of the same sessions that suits the runner's preferences at least as well as the baseline.

Hard rules (a plan that breaks any of them is discarded):
- Use only the given session keys, at most once each. Do not invent sessions.
- Every session must sit entirely inside one free window on its day, and must not cross midnight.
- At most one session per day. Keep the required rest days. Follow the rule about hard sessions on consecutive days.
- Duration must be between the session's minimum and the runner's maximum minutes.
If you cannot improve on the baseline, return the baseline unchanged.

For each session write a short, factual note (under 30 words) about why that day and time suit the runner.
Do not give medical advice or promise results.
In "alternatives", suggest up to four concrete changes the runner could make if some preferences could not be met. Return an empty list when everything fits.`;

export function buildAiRequest(base: WeeklyProposal, availability: readonly BlockLike[]) {
  const rules = RECOVERY_RULES[base.settings.fitnessLevel];
  const { templates } = buildSessionPlan(base.settings);
  const free = freeIntervals(availability);
  const windows = Object.entries(free).flatMap(([d, list]) =>
    list.map((i) => `${weekdayName(Number(d))} (weekday ${d}): ${formatRange(i.start, i.end)}`),
  );
  return [
    `Free windows (local time, ${base.timezone}):\n${windows.join("\n") || "none"}`,
    `Preferences: goal ${base.settings.goal}; level ${base.settings.fitnessLevel}; up to ${base.settings.maxSessionMinutes} minutes per session; preferred days ${base.settings.preferredDays.join(", ") || "none"}; preferred times ${base.settings.preferredTimesOfDay.join(", ") || "none"}.`,
    `Recovery rules: at least ${rules.minRestDays} rest days; at most ${rules.maxConsecutiveHardDays} hard day(s) in a row; hard types are run, walk_run, strength, conditioning.`,
    `Sessions to arrange:\n${base.sessions
      .map((s) => {
        const t = templates.find((x) => x.key === s.key);
        return `- key ${s.key}: ${s.title} (${s.workoutType}), minimum ${t?.minMinutes ?? s.durationMinutes} min, planned ${s.durationMinutes} min`;
      })
      .join("\n")}`,
    `Baseline plan:\n${base.sessions.map((s) => `- ${s.key}: weekday ${s.weekday} at ${s.startTime} for ${s.durationMinutes} min`).join("\n") || "- none"}`,
    `Preferences the baseline could not meet:\n${base.unsatisfied.map((u) => `- ${u.message}`).join("\n") || "- none"}`,
  ].join("\n\n");
}

/** Turn a validated AI suggestion into a proposal, or explain why it was rejected. */
export function applyAiSuggestion(
  base: WeeklyProposal,
  suggestion: AiScheduleSuggestion,
  availability: readonly BlockLike[],
): { ok: true; proposal: WeeklyProposal } | { ok: false; reason: string } {
  const byKey = new Map(base.sessions.map((s) => [s.key, s]));
  const seen = new Set<string>();
  for (const s of suggestion.sessions) {
    if (!byKey.has(s.key)) return { ok: false, reason: "it referred to a session that does not exist" };
    if (seen.has(s.key)) return { ok: false, reason: "it used a session twice" };
    seen.add(s.key);
  }
  if (suggestion.sessions.length < base.sessions.length) {
    return { ok: false, reason: "it placed fewer sessions than the standard plan" };
  }
  const { templates } = buildSessionPlan(base.settings);
  for (const s of suggestion.sessions) {
    const min = templates.find((t) => t.key === s.key)?.minMinutes ?? byKey.get(s.key)!.durationMinutes;
    if (s.durationMinutes < min) return { ok: false, reason: "it shortened a session below its minimum length" };
  }
  const free = freeIntervals(availability);
  const sessions: ProposedSession[] = suggestion.sessions
    .map((s) => {
      const original = byKey.get(s.key)!;
      const start = Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3));
      const window = free[s.weekday].find((i) => start >= i.start && start + s.durationMinutes <= i.end);
      return {
        ...original,
        weekday: s.weekday,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        rationale: [
          window
            ? `Fits inside your free time on ${weekdayName(s.weekday)}, ${formatRange(window.start, window.end)}.`
            : `Placed on ${weekdayName(s.weekday)} at ${s.startTime}.`,
          `${s.durationMinutes} minutes, within your ${base.settings.maxSessionMinutes}-minute limit.`,
          `AI note: ${s.note}`,
        ],
      };
    })
    .sort((a, b) => a.weekday - b.weekday);

  const violations = validateSchedule(sessions, { availability, settings: base.settings });
  if (violations.length > 0) {
    return { ok: false, reason: `it broke a scheduling rule (${violations[0].message})` };
  }
  const days = new Set(sessions.map((s) => s.weekday));
  return {
    ok: true,
    proposal: {
      ...base,
      sessions,
      restDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => !days.has(d)),
      warnings: [...base.warnings, ...(suggestion.summary ? [`AI summary: ${suggestion.summary}`] : [])],
      unsatisfied: base.unsatisfied.map((u, i) =>
        i === 0 && suggestion.alternatives.length > 0
          ? { ...u, alternatives: [...u.alternatives, ...suggestion.alternatives.map((a) => `AI suggestion: ${a}`)] }
          : u,
      ),
      source: "ai_assisted",
    },
  };
}

const FAILURE_MESSAGES: Record<AiFailureKind, string> = {
  timeout: "The AI service took too long, so this is the standard plan.",
  auth: "The AI service is misconfigured, so this is the standard plan.",
  rate_limited: "The AI service is busy, so this is the standard plan.",
  bad_request: "The AI service could not handle the request, so this is the standard plan.",
  server: "The AI service had an error, so this is the standard plan.",
  network: "The AI service could not be reached, so this is the standard plan.",
  blocked: "The AI service declined the request, so this is the standard plan.",
  malformed: "The AI service sent an unreadable answer, so this is the standard plan.",
  invalid_output: "The AI service sent an answer in the wrong format, so this is the standard plan.",
};

/**
 * Generate a proposal. `generator` is null when AI is off, unconfigured or
 * over the daily limit (`aiUnavailable` says which); the deterministic plan
 * is returned in every case where AI does not produce a valid improvement.
 */
export async function generateProposal(input: {
  weekStart: string;
  timezone: string;
  availability: readonly BlockLike[];
  settings: PlannerSettings;
  generator: StructuredGenerator | null;
  aiUnavailable?: "not_configured" | "not_requested" | "rate_limited";
}): Promise<{ result: PlanWeekOutput; ai: AiOutcome }> {
  const result = planWeek(input);
  if (result.violations.length > 0) {
    // Placement and validation disagree: never return the plan as valid.
    throw new Error(`Deterministic plan failed validation: ${result.violations.map((v) => v.code).join(", ")}`);
  }

  if (!input.generator) {
    const status = input.aiUnavailable ?? "not_configured";
    return {
      result,
      ai: {
        status,
        message:
          status === "rate_limited" ? "You have used today's AI suggestions, so this is the standard plan." : null,
      },
    };
  }
  if (result.proposal.sessions.length === 0) {
    return { result, ai: { status: "not_requested", message: null } };
  }

  const started = performance.now();
  try {
    const { result: suggestion } = await input.generator.generateStructured(AiScheduleSuggestion, {
      system: SYSTEM_PROMPT,
      text: buildAiRequest(result.proposal, input.availability),
      maxOutputTokens: 2048,
    });
    const latencyMs = Math.round(performance.now() - started);
    const applied = applyAiSuggestion(result.proposal, suggestion, input.availability);
    if (!applied.ok) {
      return {
        result,
        ai: {
          status: "rejected",
          kind: "invalid_output",
          message: `The AI suggestion was not used because ${applied.reason}. This is the standard plan.`,
          latencyMs,
        },
      };
    }
    return { result: { ...result, proposal: applied.proposal }, ai: { status: "used", message: null, latencyMs } };
  } catch (error) {
    const kind: AiFailureKind = error instanceof AiProviderError ? error.kind : "server";
    return {
      result,
      ai: {
        status: "failed",
        kind,
        message: FAILURE_MESSAGES[kind],
        latencyMs: Math.round(performance.now() - started),
      },
    };
  }
}
