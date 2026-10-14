/**
 * Character evolution. Each stage is unlocked by earned milestones (badges),
 * and stages are sequential: a stage needs every earlier stage too.
 */
export type StageDef = {
  stage: number;
  name: string;
  description: string;
  /** Each entry is a set of alternatives; every entry must be satisfied. */
  requires: { anyOf: string[]; label: string }[];
};

export const STAGES: StageDef[] = [
  { stage: 1, name: "Spark", description: "Every runner starts here.", requires: [] },
  {
    stage: 2,
    name: "Stepper",
    description: "You have taken the first step.",
    requires: [{ anyOf: ["first-workout"], label: "Complete your first workout" }],
  },
  {
    stage: 3,
    name: "Strider",
    description: "Movement is becoming a habit.",
    requires: [
      { anyOf: ["workouts-5"], label: "Complete 5 workouts" },
      { anyOf: ["streak-7"], label: "Reach a 7-day habit streak" },
    ],
  },
  {
    stage: 4,
    name: "Runner",
    description: "You can keep going for 20 minutes or more.",
    requires: [{ anyOf: ["c25k-halfway", "workouts-25"], label: "Finish C25K week 5 or complete 25 workouts" }],
  },
  {
    stage: 5,
    name: "Shining runner",
    description: "A finished programme and a month of steady weeks.",
    requires: [
      { anyOf: ["c25k-graduate", "programme-complete"], label: "Finish a programme" },
      { anyOf: ["weekly-streak-4"], label: "Meet your weekly goal 4 weeks in a row" },
    ],
  },
];

export function characterStage(badgeCodes: Iterable<string>) {
  const have = new Set(badgeCodes);
  let current = STAGES[0];
  for (const s of STAGES.slice(1)) {
    if (s.requires.every((r) => r.anyOf.some((c) => have.has(c)))) current = s;
    else break;
  }
  const next = STAGES.find((s) => s.stage === current.stage + 1) ?? null;
  return {
    stage: current.stage,
    name: current.name,
    description: current.description,
    next: next && {
      stage: next.stage,
      name: next.name,
      requirements: next.requires.map((r) => ({ label: r.label, done: r.anyOf.some((c) => have.has(c)) })),
    },
  };
}
