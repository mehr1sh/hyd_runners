import type { FitnessLevel } from "@/lib/contracts";
import { addDays, daysBetween, weekday, weekStart, type LocalDate } from "@/features/gamification/logic/time";
import type { TrainingPaces } from "./pace";
import { RACE_DISTANCES, type RaceKey } from "./predict";
import { STRENGTH_SESSIONS, type StrengthSessionKey } from "./strength-templates";
import { generateWorkout, type WorkoutDetails, type WorkoutKind } from "./workouts";

/**
 * Race preparation plan: base → build → peak → taper → race, built from the
 * runner's recent weekly distance. Conservative by design:
 * - weekly distance grows by at most 10%, with an easier week every fourth week;
 * - long runs are capped per distance and never exceed about a third of the week;
 * - beginners get no hard quality sessions in base weeks;
 * - quality sessions are at least two days from the long run and from each other.
 * It is a recommendation for the runner to review, not a prescription.
 */

export type Phase = "base" | "build" | "peak" | "taper" | "race";

export type PlanSession = {
  date: LocalDate;
  title: string;
  workoutType: "run" | "walk_run" | "strength" | "mobility";
  minutes: number;
  km: number | null;
  kind: WorkoutKind | "strength" | "race";
  details:
    | (WorkoutDetails & { km?: number })
    | { kind: "strength"; session: StrengthSessionKey }
    | { kind: "race"; distance: RaceKey };
  rationale: string[];
};

export type PlanWeek = { index: number; weekStart: LocalDate; phase: Phase; targetKm: number; sessions: PlanSession[] };

export type RacePlan = {
  distance: RaceKey;
  raceDate: LocalDate;
  startWeek: LocalDate;
  weeks: PlanWeek[];
  warnings: string[];
  assumptions: string[];
};

export type RacePlanInput = {
  distance: RaceKey;
  raceDate: LocalDate;
  today: LocalDate;
  level: FitnessLevel;
  daysPerWeek: number;
  longRunDay: number;
  recentWeeklyKm: number;
  paces: TrainingPaces | null;
  raceName?: string | null;
};

const TYPICAL_WEEKS: Record<RaceKey, number> = { "5k": 8, "10k": 10, half: 12, marathon: 16 };
const MIN_WEEKS: Record<RaceKey, number> = { "5k": 4, "10k": 6, half: 8, marathon: 12 };
const MAX_WEEKS = 20;
const PEAK_KM: Record<RaceKey, Record<FitnessLevel, number>> = {
  "5k": { new_to_running: 15, returning: 22, regular: 32 },
  "10k": { new_to_running: 20, returning: 28, regular: 40 },
  half: { new_to_running: 28, returning: 36, regular: 50 },
  marathon: { new_to_running: 40, returning: 50, regular: 65 },
};
const LONG_CAP_KM: Record<RaceKey, number> = { "5k": 10, "10k": 15, half: 19, marathon: 32 };
const START_FLOOR_KM: Record<FitnessLevel, number> = { new_to_running: 6, returning: 10, regular: 15 };
const DEFAULT_EASY_PACE: Record<FitnessLevel, number> = { new_to_running: 480, returning: 450, regular: 390 };

/** Run days as offsets before the long-run day; the first one or two are quality slots. */
const RUN_OFFSETS: Record<number, number[]> = {
  2: [0, 4],
  3: [0, 5, 3],
  4: [0, 5, 3, 1],
  5: [0, 5, 3, 1, 4],
  6: [0, 5, 3, 1, 4, 6],
};

const round1 = (x: number) => Math.round(x * 10) / 10;

function phaseFor(i: number, total: number, distance: RaceKey): Phase {
  const taper = distance === "half" || distance === "marathon" ? 2 : 1;
  if (i === total - 1) return "race";
  if (i >= total - 1 - taper) return "taper";
  const body = total - 1 - taper;
  if (i < Math.ceil(body * 0.35)) return "base";
  if (i < Math.ceil(body * 0.75)) return "build";
  return "peak";
}

function qualityKinds(phase: Phase, distance: RaceKey, level: FitnessLevel, slots: number): WorkoutKind[] {
  if (slots === 0 || phase === "race") return [];
  if (level === "new_to_running" && phase === "base") return [];
  const shortRace = distance === "5k" || distance === "10k";
  const by: Record<Exclude<Phase, "race">, WorkoutKind[]> = {
    base: ["hills", "progression"],
    build: shortRace ? ["intervals", "tempo"] : ["tempo", "hills"],
    peak: shortRace ? ["intervals", "tempo"] : ["tempo", "progression"],
    taper: ["tempo"],
  };
  return by[phase].slice(0, phase === "taper" ? 1 : slots);
}

export function planWeeksAvailable(today: LocalDate, raceDate: LocalDate) {
  const first = weekday(today) === 1 ? today : addDays(weekStart(today), 7);
  return Math.floor(daysBetween(first, weekStart(raceDate)) / 7) + 1;
}

export function generateRacePlan(input: RacePlanInput): RacePlan {
  const race = RACE_DISTANCES.find((r) => r.key === input.distance)!;
  const warnings: string[] = [];
  const assumptions: string[] = [
    "Weekly distance grows by no more than 10%, with an easier week every fourth week.",
    "Session times are estimates from your easy pace; adjust them to how you feel.",
  ];
  const available = planWeeksAvailable(input.today, input.raceDate);
  if (available < 1) throw new Error("race date is in the past");
  const total = Math.min(available, MAX_WEEKS, Math.max(TYPICAL_WEEKS[input.distance], MIN_WEEKS[input.distance]));
  const startWeek = addDays(weekStart(input.raceDate), -7 * (total - 1));
  if (available < MIN_WEEKS[input.distance])
    warnings.push(
      `Only ${available} week${available === 1 ? "" : "s"} until the race; ${MIN_WEEKS[input.distance]} or more is usual for a ${race.label}. This plan focuses on arriving healthy, not on a time.`,
    );
  if (startWeek > addDays(weekStart(input.today), 7))
    assumptions.push(
      `The plan starts on ${startWeek}, ${total} weeks before the race. Until then, keep running as you are.`,
    );

  const level = input.level;
  const days = Math.min(6, Math.max(2, input.daysPerWeek));
  const offsets = RUN_OFFSETS[days];
  const qualitySlots = days <= 2 ? (level === "regular" ? 1 : 0) : days >= 5 && level === "regular" ? 2 : 1;
  const easyPace = input.paces ? (input.paces.easy[0] + input.paces.easy[1]) / 2 : DEFAULT_EASY_PACE[level];
  if (!input.paces)
    assumptions.push("No recent 5 km or longer GPS effort, so sessions use effort levels and an estimated easy pace.");

  const floor = START_FLOOR_KM[level];
  const start =
    input.recentWeeklyKm >= floor ? input.recentWeeklyKm : Math.max(input.recentWeeklyKm * 1.1, Math.min(floor, 8));
  const peak = Math.max(start, PEAK_KM[input.distance][level]);
  if (input.distance === "marathon" && input.recentWeeklyKm < 20)
    warnings.push(
      "You're running under 20 km a week. A marathon on this timeline is ambitious; consider a half marathon first, or check with a coach.",
    );

  const longDay = input.longRunDay;
  const dayOf = (offset: number) => ((longDay - 1 - offset + 7 * 2) % 7) + 1;
  const runDays = offsets.map(dayOf);
  const freeDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !runDays.includes(d));
  const strengthDay = days <= 5 ? ([4, 2, 6, 1].map(dayOf).find((d) => freeDays.includes(d)) ?? null) : null;

  const weeks: PlanWeek[] = [];
  let prevKm = start;
  let lastBuildKm = start;
  for (let i = 0; i < total; i++) {
    const phase = phaseFor(i, total, input.distance);
    const ws = addDays(startWeek, 7 * i);
    let km: number;
    if (phase === "taper") km = lastBuildKm * (i === total - 2 ? 0.7 : 0.8);
    else if (phase === "race") km = lastBuildKm * 0.45 + race.meters / 1000;
    else if (i > 0 && (i + 1) % 4 === 0) km = prevKm * 0.8;
    else km = i === 0 ? start : Math.min(peak, Math.max(prevKm, lastBuildKm) * 1.08);
    if (phase !== "taper" && phase !== "race" && !((i + 1) % 4 === 0 && i > 0)) lastBuildKm = km;
    prevKm = km;

    const sessions: PlanSession[] = [];
    const dateOf = (d: number) => addDays(ws, d - 1);
    const quality = qualityKinds(phase, input.distance, level, qualitySlots);

    if (phase === "race") {
      const raceDay = input.raceDate;
      sessions.push({
        date: raceDay,
        title: `Race: ${input.raceName ?? race.label}`,
        workoutType: level === "new_to_running" ? "walk_run" : "run",
        minutes: Math.min(300, Math.round(((race.meters / 1000) * easyPace * 0.92) / 60)),
        km: race.meters / 1000,
        kind: "race",
        details: { kind: "race", distance: input.distance },
        rationale: ["Race day. Start conservatively and run your own pace."],
      });
      const shakeouts = runDays.filter((d) => dateOf(d) < raceDay && daysBetween(dateOf(d), raceDay) >= 2).slice(0, 2);
      for (const d of shakeouts) {
        const minutes = 25;
        const details = generateWorkout("easy", { level, minutes, paces: input.paces });
        sessions.push({
          date: dateOf(d),
          title: "Easy run (race week)",
          workoutType: level === "new_to_running" ? "walk_run" : "run",
          minutes: details.totalMinutes,
          km: round1((minutes * 60) / easyPace),
          kind: "easy",
          details,
          rationale: ["Race week: keep moving, stay fresh."],
        });
      }
    } else {
      const longKm = Math.min(LONG_CAP_KM[input.distance], km * (input.distance === "marathon" ? 0.35 : 0.32));
      const longMin = Math.min(240, Math.max(20, Math.round((longKm * easyPace) / 60)));
      const long = generateWorkout("long", { level, minutes: longMin, paces: input.paces });
      sessions.push({
        date: dateOf(runDays[0]),
        title: "Long run",
        workoutType: level === "new_to_running" ? "walk_run" : "run",
        minutes: long.totalMinutes,
        km: round1(longKm),
        kind: "long",
        details: { ...long, km: round1(longKm) },
        rationale: [`Builds endurance for the ${race.label}.`, `${phase[0].toUpperCase()}${phase.slice(1)} phase.`],
      });
      let usedKm = longKm;
      quality.forEach((kind, qi) => {
        const minutes = phase === "taper" ? 30 : 40;
        const w = generateWorkout(kind, { level, minutes, paces: input.paces });
        const qkm = round1((w.totalMinutes * 60) / easyPace);
        usedKm += qkm;
        sessions.push({
          date: dateOf(runDays[1 + qi]),
          title: w.title,
          workoutType: level === "new_to_running" ? "walk_run" : "run",
          minutes: w.totalMinutes,
          km: qkm,
          kind,
          details: w,
          rationale: [`${w.title} for ${phase === "taper" ? "sharpness while you taper" : `${race.label} fitness`}.`],
        });
      });
      const easyDays = runDays.slice(1 + quality.length);
      const easyKm = easyDays.length ? Math.max(2, (km - usedKm) / easyDays.length) : 0;
      for (const d of easyDays) {
        const minutes = Math.min(90, Math.max(20, Math.round((easyKm * easyPace) / 60)));
        const w = generateWorkout("easy", { level, minutes, paces: input.paces });
        sessions.push({
          date: dateOf(d),
          title: "Easy run",
          workoutType: level === "new_to_running" ? "walk_run" : "run",
          minutes: w.totalMinutes,
          km: round1((w.totalMinutes * 60) / easyPace),
          kind: "easy",
          details: { ...w, km: round1(easyKm) },
          rationale: ["Easy running builds your aerobic base with little strain."],
        });
      }
      if (strengthDay && phase !== "taper") {
        const key: StrengthSessionKey = phase === "base" ? "runner_foundation" : "single_leg_stability";
        sessions.push({
          date: dateOf(strengthDay),
          title: STRENGTH_SESSIONS[key].title,
          workoutType: "strength",
          minutes: STRENGTH_SESSIONS[key].minutes,
          km: null,
          kind: "strength",
          details: { kind: "strength", session: key },
          rationale: ["Strength work for hips, glutes and calves supports running."],
        });
      }
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({
      index: i + 1,
      weekStart: ws,
      phase,
      targetKm: round1(sessions.reduce((s, x) => s + (x.km ?? 0), 0) || km),
      sessions: sessions.filter((s) => s.date >= input.today && s.date <= input.raceDate),
    });
  }
  return { distance: input.distance, raceDate: input.raceDate, startWeek, weeks, warnings, assumptions };
}

export const PHASE_LABEL: Record<Phase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race: "Race week",
};
