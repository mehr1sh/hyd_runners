/** Badge rules. Codes and rewards must match the `badges` rows in the migration. */
export type BadgeDef = { code: string; title: string; description: string; xp: number; coins: number };

export const BADGES: BadgeDef[] = [
  { code: "first-workout", title: "First steps", description: "Completed your first workout.", xp: 20, coins: 5 },
  { code: "workouts-5", title: "Five and thriving", description: "Completed 5 workouts.", xp: 30, coins: 10 },
  { code: "workouts-25", title: "Twenty-five strong", description: "Completed 25 workouts.", xp: 75, coins: 25 },
  { code: "workouts-50", title: "Half-century", description: "Completed 50 workouts.", xp: 150, coins: 50 },
  { code: "streak-7", title: "Week-long habit", description: "Reached a 7-day habit streak.", xp: 40, coins: 10 },
  {
    code: "weekly-streak-4",
    title: "Four steady weeks",
    description: "Met your weekly goal 4 weeks in a row.",
    xp: 80,
    coins: 20,
  },
  { code: "c25k-week-1", title: "Week 1 done", description: "Finished week 1 of Couch to 5K.", xp: 25, coins: 5 },
  {
    code: "c25k-halfway",
    title: "Halfway there",
    description: "Finished week 5 of Couch to 5K, including your first 20-minute run.",
    xp: 60,
    coins: 15,
  },
  {
    code: "c25k-graduate",
    title: "Couch to 5K graduate",
    description: "Finished all nine weeks of Couch to 5K.",
    xp: 200,
    coins: 50,
  },
  {
    code: "programme-complete",
    title: "Programme finisher",
    description: "Completed every session of a programme.",
    xp: 100,
    coins: 25,
  },
  { code: "distance-5k", title: "5 km covered", description: "Ran or walk-ran 5 km in total.", xp: 25, coins: 5 },
  {
    code: "distance-42k",
    title: "Marathon in pieces",
    description: "Ran or walk-ran 42.2 km in total.",
    xp: 100,
    coins: 25,
  },
  {
    code: "all-rounder",
    title: "All-rounder",
    description: "Logged running, strength and mobility work.",
    xp: 40,
    coins: 10,
  },
  { code: "early-bird", title: "Early bird", description: "Started a workout before 7:00.", xp: 15, coins: 5 },
  {
    code: "challenges-3",
    title: "Challenge accepted",
    description: "Completed 3 weekly challenges.",
    xp: 50,
    coins: 15,
  },
  {
    code: "community-first-rsvp",
    title: "Joined a group run",
    description: "Signed up for your first community event.",
    xp: 10,
    coins: 0,
  },
];

export const BADGE_BY_CODE = new Map(BADGES.map((b) => [b.code, b]));

export const RUN_TYPES = new Set(["run", "walk_run"]);
export const STRENGTH_TYPES = new Set(["strength", "conditioning"]);
export const MOBILITY_TYPES = new Set(["mobility"]);
