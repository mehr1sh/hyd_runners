import { describe, expect, it } from "vitest";
import { DEFAULT_CUE_PREFS, initialCueState, nextCues, type CueInput, type CuePrefs } from "./cues";
import { PRESET_WORKOUTS, advanceWorkout, startWorkout, stepRemaining, type PlannedWorkout } from "./workout";

/** Feed a steady run (metres per second) second by second and collect cues with their time. */
function simulate(
  prefs: CuePrefs,
  plan: PlannedWorkout | null,
  seconds: number,
  speed: (t: number) => number,
  pace?: (t: number) => number | null,
) {
  let state = initialCueState(prefs, plan);
  let d = 0;
  const out: { t: number; text: string; kind: string }[] = [];
  for (let t = 1; t <= seconds; t++) {
    d += speed(t);
    const input: CueInput = {
      distanceM: d,
      movingS: t,
      currentPace: pace ? pace(t) : speed(t) > 0 ? 1000 / speed(t) : null,
    };
    const r = nextCues(prefs, plan, state, input);
    state = r.state;
    for (const c of r.cues) out.push({ t, ...c });
  }
  return out;
}

describe("split announcements", () => {
  it("announces every kilometre with the split pace", () => {
    const cues = simulate(DEFAULT_CUE_PREFS, null, 1500, () => 3.125); // 5:20/km
    const splits = cues.filter((c) => c.kind === "split");
    expect(splits.map((c) => c.t)).toEqual([320, 640, 960, 1280]);
    expect(splits[0].text).toBe("1 kilometre. Time 5 minutes 20 seconds. Last split 5 20 per kilometre.");
    expect(splits[1].text).toMatch(/^2 kilometres/);
  });

  it("respects the chosen frequency and muting", () => {
    expect(simulate({ ...DEFAULT_CUE_PREFS, splitEveryKm: 2 }, null, 1500, () => 3.125).map((c) => c.t)).toEqual([
      640, 1280,
    ]);
    expect(simulate({ ...DEFAULT_CUE_PREFS, splitEveryKm: 0 }, null, 1500, () => 3.125)).toEqual([]);
    expect(simulate({ ...DEFAULT_CUE_PREFS, muted: true }, null, 1500, () => 3.125)).toEqual([]);
  });

  it("does not repeat skipped splits after a GPS gap", () => {
    // 2.5 km arrive at once (a gap): one announcement, not three.
    const cues = simulate(DEFAULT_CUE_PREFS, null, 10, (t) => (t === 5 ? 2500 : 0));
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toMatch(/^2 kilometres/);
  });
});

describe("workouts", () => {
  const plan: PlannedWorkout = {
    id: "t",
    name: "Test",
    steps: [
      { kind: "warmup", label: "Warm-up", durationS: 60 },
      { kind: "work", label: "Fast", distanceM: 400, pace: { min: 240, max: 270 } },
      { kind: "recover", label: "Jog", durationS: 60 },
    ],
  };

  it("advances through distance and timed steps", () => {
    let w = startWorkout();
    ({ state: w } = advanceWorkout(plan, w, 150, 59));
    expect(w.index).toBe(0);
    let r = advanceWorkout(plan, w, 160, 60);
    expect(r.changes.map((c) => c.to)).toEqual([1]);
    w = r.state;
    expect(stepRemaining(plan, w, 360, 100)).toEqual({ meters: 200 });
    r = advanceWorkout(plan, w, 560, 150);
    expect(r.changes.map((c) => c.to)).toEqual([2]);
    expect(stepRemaining(plan, r.state, 600, 170)).toEqual({ seconds: 40 });
    r = advanceWorkout(plan, r.state, 700, 210);
    expect(r.changes).toEqual([{ from: 2, to: 3, step: null }]);
  });

  it("announces step changes, then completion", () => {
    const cues = simulate(
      DEFAULT_CUE_PREFS,
      plan,
      400,
      () => 4,
      () => 255,
    );
    const steps = cues.filter((c) => c.kind === "step" || c.kind === "done");
    expect(steps.map((c) => c.text)).toEqual([
      "Fast, 400 metres, target 4 minutes per kilometre to 4 30 per kilometre.",
      "Jog, 1 minutes.",
      "Workout complete. Nice work.",
    ]);
  });

  it("nudges when off target for a while, but not too often", () => {
    const long: PlannedWorkout = {
      id: "l",
      name: "L",
      steps: [{ kind: "work", label: "Tempo", durationS: 600, pace: { min: 285, max: 315 } }],
    };
    const prefs = { ...DEFAULT_CUE_PREFS, splitEveryKm: 0 as const };
    const nudges = simulate(
      prefs,
      long,
      590,
      () => 2,
      () => 400,
    ).filter((c) => c.kind === "pace");
    expect(nudges[0]).toMatchObject({ t: 31, text: "Pick it up a little." });
    // At most one per 90 s.
    for (let i = 1; i < nudges.length; i++) expect(nudges[i].t - nudges[i - 1].t).toBeGreaterThanOrEqual(90);
    expect(
      simulate(
        prefs,
        long,
        590,
        () => 3.4,
        () => 300,
      ).filter((c) => c.kind === "pace"),
    ).toEqual([]);
    expect(
      simulate(
        { ...prefs, paceNudges: false },
        long,
        590,
        () => 2,
        () => 400,
      ),
    ).toEqual([]);
  });

  it("ships sensible presets", () => {
    for (const p of PRESET_WORKOUTS) {
      expect(p.steps.length).toBeGreaterThan(0);
      for (const s of p.steps) expect((s.distanceM ?? 0) > 0 || (s.durationS ?? 0) > 0).toBe(true);
    }
  });
});
