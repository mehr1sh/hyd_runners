/**
 * Strength and mobility catalogue. Each exercise lists the muscles it mainly
 * works (primary) and supports (secondary), from standard exercise anatomy.
 * The muscle map only highlights muscles listed here for exercises the runner
 * actually logged. Keys are stored in logs, so never rename one.
 */

export const MUSCLES = [
  "glutes",
  "hip_abductors",
  "hip_flexors",
  "quads",
  "hamstrings",
  "calves",
  "adductors",
  "core",
  "obliques",
  "lower_back",
  "upper_back",
  "shoulders",
  "chest",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  glutes: "Glutes",
  hip_abductors: "Hip abductors",
  hip_flexors: "Hip flexors",
  quads: "Quadriceps",
  hamstrings: "Hamstrings",
  calves: "Calves",
  adductors: "Adductors",
  core: "Core (abdominals)",
  obliques: "Obliques",
  lower_back: "Lower back",
  upper_back: "Upper back",
  shoulders: "Shoulders",
  chest: "Chest",
};

export type ExerciseCategory =
  "core" | "glutes" | "hips" | "hamstrings" | "calves" | "single_leg" | "mobility" | "stretch";

export type Exercise = {
  key: string;
  name: string;
  category: ExerciseCategory;
  primary: Muscle[];
  secondary: Muscle[];
  /** Default prescription, e.g. "3 × 10 each side". */
  dose: string;
  cue: string;
};

export const EXERCISES: Exercise[] = [
  {
    key: "glute_bridge",
    name: "Glute bridge",
    category: "glutes",
    primary: ["glutes"],
    secondary: ["hamstrings", "core"],
    dose: "3 × 12",
    cue: "Squeeze your glutes at the top; don't arch your back.",
  },
  {
    key: "single_leg_bridge",
    name: "Single-leg glute bridge",
    category: "single_leg",
    primary: ["glutes"],
    secondary: ["hamstrings", "core"],
    dose: "3 × 8 each side",
    cue: "Keep your hips level.",
  },
  {
    key: "clamshell",
    name: "Clamshell",
    category: "hips",
    primary: ["hip_abductors"],
    secondary: ["glutes"],
    dose: "2 × 15 each side",
    cue: "Keep your feet together and pelvis still.",
  },
  {
    key: "side_lying_leg_raise",
    name: "Side-lying leg raise",
    category: "hips",
    primary: ["hip_abductors"],
    secondary: ["obliques"],
    dose: "2 × 12 each side",
    cue: "Lead with the heel, toes forward.",
  },
  {
    key: "monster_walk",
    name: "Band side walk",
    category: "hips",
    primary: ["hip_abductors", "glutes"],
    secondary: ["quads"],
    dose: "2 × 10 steps each way",
    cue: "Stay low and keep tension in the band.",
  },
  {
    key: "plank",
    name: "Plank",
    category: "core",
    primary: ["core"],
    secondary: ["shoulders", "glutes"],
    dose: "3 × 30 s",
    cue: "Straight line from head to heels.",
  },
  {
    key: "side_plank",
    name: "Side plank",
    category: "core",
    primary: ["obliques"],
    secondary: ["hip_abductors", "shoulders"],
    dose: "2 × 20 s each side",
    cue: "Hips high, body in one line.",
  },
  {
    key: "dead_bug",
    name: "Dead bug",
    category: "core",
    primary: ["core"],
    secondary: ["hip_flexors"],
    dose: "3 × 8 each side",
    cue: "Press your lower back into the floor.",
  },
  {
    key: "bird_dog",
    name: "Bird dog",
    category: "core",
    primary: ["core", "lower_back"],
    secondary: ["glutes", "shoulders"],
    dose: "3 × 8 each side",
    cue: "Move slowly; keep your hips square.",
  },
  {
    key: "squat",
    name: "Bodyweight squat",
    category: "glutes",
    primary: ["quads", "glutes"],
    secondary: ["hamstrings", "core"],
    dose: "3 × 12",
    cue: "Knees track over toes; chest up.",
  },
  {
    key: "split_squat",
    name: "Split squat",
    category: "single_leg",
    primary: ["quads", "glutes"],
    secondary: ["hamstrings", "adductors"],
    dose: "3 × 8 each side",
    cue: "Front knee stays over the ankle.",
  },
  {
    key: "step_up",
    name: "Step-up",
    category: "single_leg",
    primary: ["quads", "glutes"],
    secondary: ["calves", "hamstrings"],
    dose: "3 × 8 each side",
    cue: "Push through the whole front foot.",
  },
  {
    key: "single_leg_rdl",
    name: "Single-leg Romanian deadlift",
    category: "single_leg",
    primary: ["hamstrings", "glutes"],
    secondary: ["lower_back", "core"],
    dose: "3 × 8 each side",
    cue: "Hinge at the hip with a long back.",
  },
  {
    key: "hamstring_bridge_walkout",
    name: "Hamstring walkout",
    category: "hamstrings",
    primary: ["hamstrings"],
    secondary: ["glutes"],
    dose: "2 × 6",
    cue: "Walk the heels out only as far as you control.",
  },
  {
    key: "calf_raise",
    name: "Calf raise",
    category: "calves",
    primary: ["calves"],
    secondary: [],
    dose: "3 × 15",
    cue: "Slowly down, full range.",
  },
  {
    key: "single_leg_calf_raise",
    name: "Single-leg calf raise",
    category: "calves",
    primary: ["calves"],
    secondary: [],
    dose: "3 × 10 each side",
    cue: "Use a wall for balance only.",
  },
  {
    key: "bent_knee_calf_raise",
    name: "Bent-knee calf raise",
    category: "calves",
    primary: ["calves"],
    secondary: ["quads"],
    dose: "2 × 15",
    cue: "Keep the knee bent throughout.",
  },
  {
    key: "hip_flexor_stretch",
    name: "Kneeling hip flexor stretch",
    category: "stretch",
    primary: ["hip_flexors"],
    secondary: ["quads"],
    dose: "2 × 30 s each side",
    cue: "Tuck your pelvis; don't lean back.",
  },
  {
    key: "hamstring_stretch",
    name: "Hamstring stretch",
    category: "stretch",
    primary: ["hamstrings"],
    secondary: [],
    dose: "2 × 30 s each side",
    cue: "Hinge forward gently; no bouncing.",
  },
  {
    key: "calf_stretch",
    name: "Wall calf stretch",
    category: "stretch",
    primary: ["calves"],
    secondary: [],
    dose: "2 × 30 s each side",
    cue: "Heel down, back leg straight.",
  },
  {
    key: "hip_circles",
    name: "Leg swings and hip circles",
    category: "mobility",
    primary: ["hip_flexors", "hip_abductors"],
    secondary: ["adductors"],
    dose: "10 each direction",
    cue: "Controlled and relaxed.",
  },
  {
    key: "worlds_greatest",
    name: "Lunge with thoracic rotation",
    category: "mobility",
    primary: ["hip_flexors", "upper_back"],
    secondary: ["hamstrings", "adductors"],
    dose: "5 each side",
    cue: "Rotate from the upper back.",
  },
  {
    key: "cat_cow",
    name: "Cat-cow",
    category: "mobility",
    primary: ["lower_back", "upper_back"],
    secondary: ["core"],
    dose: "10 slow reps",
    cue: "Move one segment at a time.",
  },
  {
    key: "push_up",
    name: "Push-up",
    category: "core",
    primary: ["chest", "shoulders"],
    secondary: ["core"],
    dose: "3 × 8",
    cue: "Knees down is fine; keep a straight line.",
  },
];

export const EXERCISE_BY_KEY = new Map(EXERCISES.map((e) => [e.key, e]));

export const STRENGTH_SESSIONS = {
  runner_foundation: {
    title: "Strength: runner foundation",
    minutes: 25,
    focus: "Core, glutes and calves",
    exercises: ["glute_bridge", "clamshell", "plank", "dead_bug", "squat", "calf_raise"],
  },
  single_leg_stability: {
    title: "Strength: single-leg stability",
    minutes: 30,
    focus: "Single-leg strength and hip stability",
    exercises: ["split_squat", "single_leg_rdl", "step_up", "side_plank", "single_leg_calf_raise", "monster_walk"],
  },
  hamstrings_calves: {
    title: "Strength: hamstrings and calves",
    minutes: 25,
    focus: "Posterior chain",
    exercises: [
      "single_leg_bridge",
      "hamstring_bridge_walkout",
      "single_leg_rdl",
      "bent_knee_calf_raise",
      "single_leg_calf_raise",
      "bird_dog",
    ],
  },
  mobility_reset: {
    title: "Mobility reset",
    minutes: 20,
    focus: "Hips, back and calves",
    exercises: ["hip_circles", "worlds_greatest", "cat_cow", "hip_flexor_stretch", "hamstring_stretch", "calf_stretch"],
  },
} as const satisfies Record<string, { title: string; minutes: number; focus: string; exercises: readonly string[] }>;
export type StrengthSessionKey = keyof typeof STRENGTH_SESSIONS;
