/**
 * The sample community used by the local demo seed. Every account here is
 * fictional: display names end in "(sample)", emails use the reserved
 * `.test` domain, and each account carries `app_metadata.demo = true`, which
 * only the service role can set.
 *
 * Ids follow `de<kind>-0000-4000-8000-<n>` (see `demoId`). The SQL stages
 * (community.sql, social.sql) use the same scheme through `pg_temp.o()`.
 */

export const DEMO_EMAIL_DOMAIN = "demo.hydrunners.test";

/** Object kinds in demo ids. Keep in sync with the comment at the top of community.sql. */
export const KIND = {
  person: 0,
  club: 1,
  series: 2,
  event: 3,
  squad: 4,
  league: 6,
  challenge: 8,
  raceEntry: 9,
  activity: 13,
  raceGoal: 19,
  workout: 25,
} as const;

export function demoId(kind: number, n: number) {
  return `de${String(kind).padStart(6, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export type RunnerKind = "runner" | "walker" | "c25k" | "return";

export type DemoPerson = {
  n: number;
  key: string;
  name: string;
  roles?: ("coach" | "programme_manager" | "admin")[];
  /** How the TypeScript stage builds their history. */
  kind: RunnerKind | "none";
  /** Easy pace in seconds per km (runners only). */
  easyPace?: number;
  /** Runs per week outside group runs. */
  perWeek?: number;
  /** Weeks of GPS history to generate. */
  weeks?: number;
  /** Where their GPS runs happen. */
  route?: "kbr" | "bachupally";
};

export const PEOPLE: DemoPerson[] = [
  { n: 1, key: "meera", name: "Meera Iyer", kind: "runner", easyPace: 405, perWeek: 3, weeks: 8, route: "kbr" },
  { n: 2, key: "kiran", name: "Kiran Rao", kind: "runner", easyPace: 345, perWeek: 3, weeks: 5, route: "kbr" },
  { n: 3, key: "sana", name: "Sana Qureshi", kind: "runner", easyPace: 450, perWeek: 2, weeks: 5, route: "kbr" },
  { n: 4, key: "vikram", name: "Vikram Goud", kind: "runner", easyPace: 315, perWeek: 3, weeks: 5, route: "kbr" },
  { n: 5, key: "priya", name: "Priya Nair", kind: "c25k" },
  { n: 6, key: "imran", name: "Imran Siddiqui", kind: "runner", easyPace: 370, perWeek: 2, weeks: 5, route: "kbr" },
  { n: 7, key: "lakshmi", name: "Lakshmi Prasanna", kind: "runner", easyPace: 410, perWeek: 2, weeks: 4, route: "kbr" },
  { n: 8, key: "rohit", name: "Rohit Varma", kind: "runner", easyPace: 360, perWeek: 2, weeks: 4, route: "kbr" },
  { n: 9, key: "anjali", name: "Anjali Deshpande", kind: "return" },
  {
    n: 10,
    key: "farhan",
    name: "Farhan Ali",
    kind: "runner",
    easyPace: 330,
    perWeek: 3,
    weeks: 4,
    route: "bachupally",
  },
  { n: 11, key: "divya", name: "Divya Menon", kind: "runner", easyPace: 390, perWeek: 3, weeks: 5, route: "kbr" },
  { n: 12, key: "suresh", name: "Suresh Babu", kind: "runner", easyPace: 425, perWeek: 2, weeks: 4, route: "kbr" },
  {
    n: 13,
    key: "nikhil",
    name: "Nikhil Jain",
    kind: "runner",
    easyPace: 375,
    perWeek: 2,
    weeks: 4,
    route: "bachupally",
  },
  { n: 14, key: "ayesha", name: "Ayesha Khan", kind: "walker" },
  { n: 15, key: "tanvi", name: "Tanvi Kulkarni", kind: "runner", easyPace: 370, perWeek: 2, weeks: 4, route: "kbr" },
  { n: 16, key: "harsha", name: "Harsha Vardhan", kind: "runner", easyPace: 320, perWeek: 3, weeks: 4, route: "kbr" },
  {
    n: 17,
    key: "sandeep",
    name: "Sandeep Kumar",
    roles: ["coach"],
    kind: "runner",
    easyPace: 335,
    perWeek: 2,
    weeks: 3,
    route: "kbr",
  },
  { n: 18, key: "nandini", name: "Nandini Reddy", roles: ["coach"], kind: "none" },
  { n: 19, key: "arvind", name: "Arvind Sharma", roles: ["coach"], kind: "none" },
  { n: 20, key: "fatima", name: "Fatima Begum", roles: ["coach"], kind: "none" },
  {
    n: 21,
    key: "ramesh",
    name: "Ramesh Yadav",
    roles: ["coach"],
    kind: "runner",
    easyPace: 380,
    perWeek: 2,
    weeks: 3,
    route: "kbr",
  },
  { n: 22, key: "team", name: "HYD Runners programme team", roles: ["programme_manager", "admin"], kind: "none" },
];

export const personId = (p: Pick<DemoPerson, "n">) => demoId(KIND.person, p.n);
export const emailFor = (p: Pick<DemoPerson, "key">) => `${p.key}@${DEMO_EMAIL_DOMAIN}`;
export const displayNameFor = (p: Pick<DemoPerson, "name">) => `${p.name} (sample)`;
export const byKey = (key: string) => {
  const p = PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown demo person ${key}`);
  return p;
};

/** The account to sign in with locally. */
export const MAIN_ACCOUNT = byKey("meera");
