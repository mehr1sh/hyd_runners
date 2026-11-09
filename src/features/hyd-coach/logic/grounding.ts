import { z } from "zod";
import type { CoachAnswer } from "./types";

/**
 * The optional AI step only rephrases a deterministic answer. It receives the
 * question, the facts (label and value only: no names, places, GPS, ids or
 * free text from the database) and the draft. Its reply is accepted only if
 * every number in it appears in those inputs and it cites only known facts.
 */

export const PhrasedAnswer = z.object({
  answer: z.string().min(1).max(1500),
  usedFactIds: z.array(z.string().max(40)).max(30),
  uncertainty: z.string().max(400),
});
export type PhrasedAnswer = z.infer<typeof PhrasedAnswer>;

export const PHRASING_SYSTEM_PROMPT = `You are HYD Coach, a running coach inside the HYD Runners app in Hyderabad.
You rewrite a draft answer to a runner's question so it reads naturally and helpfully.

Strict rules:
- Use ONLY the facts provided. Never invent or estimate distances, times, paces, dates, records, heart rate, sleep, weather or race results.
- Every number you write must appear in the facts or the draft.
- Keep every caveat from the draft. Keep "missing data" points.
- If the facts are insufficient, say so plainly.
- Never diagnose injuries or illness, never suggest running through pain, and never make claims about injury risk. For pain or symptoms, recommend a doctor or physiotherapist.
- Don't present your suggestions as scientifically proven.
- Plain, warm British English, at most 180 words. No markdown headings.
- usedFactIds must list the ids of the facts you relied on.`;

export function factSheet(question: string, draft: CoachAnswer) {
  return [
    `Runner's question: ${question}`,
    "",
    "Facts (id | label | value):",
    ...draft.basis.map((f) => `${f.id} | ${f.label} | ${f.value}`),
    "",
    `Missing data: ${draft.missing.length ? draft.missing.join(" ") : "none"}`,
    "",
    "Draft answer:",
    draft.text,
    draft.recommendation ? `\nDraft recommendation: ${draft.recommendation}` : "",
    draft.uncertainty ? `\nDraft caveat: ${draft.uncertainty}` : "",
  ].join("\n");
}

const NUMBER = /\d+(?:[.:,]\d+)*/g;

/** Numbers in `text` that do not occur in any of the sources. */
export function ungroundedNumbers(text: string, sources: string[]) {
  const allowed = new Set(sources.flatMap((s) => s.match(NUMBER) ?? []));
  // Allow small counting words written as digits ("4 weeks" from the question, list numbering 1–5).
  for (let i = 0; i <= 5; i++) allowed.add(String(i));
  return [...new Set(text.match(NUMBER) ?? [])].filter((n) => !allowed.has(n));
}

const UNSAFE =
  /\b(diagnos\w*|you (have|likely have|probably have) (an? )?(injury|fracture|tendinitis|condition)|run through (the )?pain|push through (the )?pain|injury risk is (low|high))\b/i;

export type GroundingResult = { ok: true } | { ok: false; reason: "ungrounded_number" | "unknown_fact" | "unsafe" };

export function checkGrounding(question: string, draft: CoachAnswer, phrased: PhrasedAnswer): GroundingResult {
  const sources = [
    question,
    draft.text,
    draft.recommendation ?? "",
    draft.uncertainty ?? "",
    ...draft.basis.map((f) => `${f.label} ${f.value}`),
  ];
  if (ungroundedNumbers(`${phrased.answer} ${phrased.uncertainty}`, sources).length > 0)
    return { ok: false, reason: "ungrounded_number" };
  const ids = new Set(draft.basis.map((f) => f.id));
  if (phrased.usedFactIds.some((id) => !ids.has(id))) return { ok: false, reason: "unknown_fact" };
  if (UNSAFE.test(phrased.answer) || UNSAFE.test(phrased.uncertainty)) return { ok: false, reason: "unsafe" };
  return { ok: true };
}
