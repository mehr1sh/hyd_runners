/**
 * Deterministic question routing for HYD Coach. Each question maps to one
 * intent, which decides what data is retrieved and how the answer is built.
 * Safety comes first: any mention of pain or worrying symptoms gets the
 * professional-assessment reply and is never sent to an AI provider.
 */

export const INTENTS = [
  "safety",
  "progress",
  "pace_drop",
  "consistency",
  "best_effort",
  "routes",
  "mileage_ramp",
  "next_weeks",
  "today",
  "race",
  "month_compare",
  "recovery",
  "overview",
] as const;
export type Intent = (typeof INTENTS)[number];

const RULES: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: "safety",
    patterns: [
      /\b(pain|painful|hurts?|hurting|ache|aching|injur(y|ed|ies)|sprain|strain(ed)?|swollen|swelling|numb(ness)?|tingl\w*)\b/,
      /\b(chest|dizz(y|iness)|faint(ed|ing)?|palpitation|breathless|short of breath|blackout|collapsed?)\b/,
      /\b(shin splints?|stress fracture|plantar|achilles|it ?band|runner'?s knee|tendon\w*)\b/,
    ],
  },
  {
    intent: "pace_drop",
    patterns: [/\b(pace|speed)\b.*\b(drop(ped)?|worse|slow(er|ed)?|fell|declin\w*)\b/, /\bwhy\b.*\bslow(er)?\b/],
  },
  { intent: "best_effort", patterns: [/\b(best|fastest|quickest|pb|pr|personal (best|record))\b/] },
  { intent: "routes", patterns: [/\broutes?\b/, /\bwhere do i (run|perform)\b/] },
  {
    intent: "mileage_ramp",
    patterns: [
      /\b(mileage|volume|distance|load)\b.*\b(too (quickly|fast|much)|increas\w*|ramp\w*|jump\w*)\b/,
      /\btoo much\b/,
    ],
  },
  {
    intent: "next_weeks",
    patterns: [
      /\bnext (few|four|4|two|2|three|3) weeks\b/,
      /\b(next|coming) (month|weeks)\b/,
      /\bwhat should my\b.*\b(look like|weeks?)\b/,
    ],
  },
  {
    intent: "today",
    patterns: [/\btoday\b/, /\b(easy|tempo|interval|rest)\b.*\bor\b/, /\bshould i (run|rest|train)\b/, /\bright now\b/],
  },
  { intent: "race", patterns: [/\b(race|marathon|half|10 ?k|5 ?k race|predict\w*|finish time)\b/] },
  {
    intent: "month_compare",
    patterns: [/\b(last|previous) month\b/, /\bcompared? (with|to)\b/, /\bthis month\b/, /\bwhat did i improve\b/],
  },
  { intent: "consistency", patterns: [/\bconsisten\w*\b/, /\bregular(ly)?\b/, /\bstreak\b/, /\bhow often\b/] },
  { intent: "progress", patterns: [/\b(faster|improv\w*|progress\w*|getting better|fitter|on track)\b/] },
  { intent: "recovery", patterns: [/\b(recover\w*|tired|fatigue\w*|sore(ness)?|sleep|rest day|readiness)\b/] },
];

export function detectIntent(question: string): Intent {
  const q = question.toLowerCase().replace(/\s+/g, " ");
  for (const rule of RULES) if (rule.patterns.some((p) => p.test(q))) return rule.intent;
  return "overview";
}

/** Which race distance a question is about, if it names one. */
export function mentionedDistance(question: string): "5k" | "10k" | "half" | "marathon" | null {
  const q = question.toLowerCase();
  if (/\bhalf\b/.test(q)) return "half";
  if (/\bmarathon\b/.test(q)) return "marathon";
  if (/\b10 ?k(m)?\b|\b10 kilomet/.test(q)) return "10k";
  if (/\b5 ?k(m)?\b|\b5 kilomet|\bparkrun\b/.test(q)) return "5k";
  return null;
}

export const SUGGESTED_QUESTIONS = [
  "Am I getting faster?",
  "How consistent have I been?",
  "What is my best 5K?",
  "Have I increased my mileage too quickly?",
  "Should I do an easy run or a tempo session today?",
  "What should my next four weeks look like?",
  "What did I improve compared with last month?",
  "How am I progressing towards my next race?",
  "Why did my pace drop this month?",
  "Which routes do I perform best on?",
];
