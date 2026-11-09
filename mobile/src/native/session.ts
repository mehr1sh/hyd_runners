/**
 * The recording session: glues the pure recorder, the SQLite journal, location
 * updates, audio cues and the upload queue together. A module singleton so the
 * background location task and the UI share one recorder.
 */
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";
import { AppState } from "react-native";
import { DEFAULT_CUE_PREFS, initialCueState, nextCues, type CuePrefs, type CueState } from "../recording/cues";
import { toQueuedRun } from "../recording/finish";
import { JournaledRecorder, type RecordingMeta } from "../recording/journal";
import { metrics } from "../recording/recorder";
import { samplingMode } from "../recording/sampling";
import { PRESET_WORKOUTS, type PlannedWorkout } from "../recording/workout";
import { reportError } from "../lib/report-error";
import { SqliteJournalStore, getPref, setPref } from "../storage/db";
import { setFixSink, startUpdates, stopUpdates } from "./location";
import { syncQueue } from "./sync";

const store = new SqliteJournalStore();
let recorder: JournaledRecorder | null = null;
let loaded: Promise<void> | null = null;
let cuePrefs: CuePrefs = DEFAULT_CUE_PREFS;
let cueState: CueState | null = null;
let backgroundUpdates = false;
const listeners = new Set<() => void>();

export const planFor = (id: string | null): PlannedWorkout | null => PRESET_WORKOUTS.find((w) => w.id === id) ?? null;

function notify() {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Load cue preferences and any interrupted recording from disk (once). */
export function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    cuePrefs = await getPref("cues", DEFAULT_CUE_PREFS);
    recorder = await JournaledRecorder.recover(store, Date.now());
    if (recorder) fastForwardCues();
    notify();
  })().catch((e) => {
    loaded = null;
    reportError(e, "session-load");
  });
  return loaded;
}

/** After recovery, advance the cue schedule silently so nothing old is announced. */
function fastForwardCues() {
  if (!recorder) return;
  const plan = planFor(recorder.meta.workoutId);
  const m = metrics(recorder.state, Date.now());
  cueState = nextCues({ ...cuePrefs, muted: true }, plan, initialCueState(cuePrefs, plan), {
    distanceM: m.distanceM,
    movingS: m.movingS,
    currentPace: null,
  }).state;
}

export function current() {
  return recorder;
}

/** Position in the planned workout (owned by the cue schedule). */
export function workoutState() {
  return cueState?.workout ?? null;
}

export function isBackgroundRecording() {
  return backgroundUpdates;
}

export function getCuePrefs() {
  return cuePrefs;
}

export async function setCuePrefs(prefs: CuePrefs) {
  cuePrefs = prefs;
  await setPref("cues", prefs);
  if (prefs.muted) Speech.stop();
  notify();
}

function speak(text: string) {
  Speech.speak(text, { language: "en-IN", rate: 1.0 });
}

// Fixes from the location task or the foreground watcher.
setFixSink((fixes) => {
  void (async () => {
    await ensureLoaded();
    const r = recorder;
    if (!r || (r.state.status !== "recording" && r.state.status !== "paused")) return;
    for (const fix of fixes) await r.record({ type: "fix", fix });
    if (r.state.status === "recording" && cueState) {
      const plan = planFor(r.meta.workoutId);
      const m = metrics(r.state, Date.now());
      const out = nextCues(cuePrefs, plan, cueState, {
        distanceM: m.distanceM,
        movingS: m.movingS,
        currentPace: m.currentPace,
      });
      cueState = out.state;
      for (const c of out.cues) speak(c.text);
    }
    notify();
  })().catch((e) => reportError(e, "ingest"));
});

async function retune() {
  const r = recorder;
  if (!r || (r.state.status !== "recording" && r.state.status !== "paused")) return;
  try {
    ({ background: backgroundUpdates } = await startUpdates(
      samplingMode(AppState.currentState === "active", r.state.status === "paused"),
    ));
  } catch (e) {
    reportError(e, "location-start");
  }
  notify();
}

// Battery: high accuracy on screen, balanced when backgrounded or screen off.
AppState.addEventListener("change", () => {
  void retune();
});

export async function start(activityType: RecordingMeta["activityType"], workoutId: string | null) {
  await ensureLoaded();
  // Never overwrite a stored recording (in progress or finished but unsaved).
  if (recorder) throw new Error("Save or discard the previous run first.");
  const now = Date.now();
  const meta: RecordingMeta = { clientRef: Crypto.randomUUID(), activityType, workoutId, createdAt: now };
  recorder = await JournaledRecorder.start(store, meta, now);
  const plan = planFor(workoutId);
  cueState = initialCueState(cuePrefs, plan);
  if (plan?.steps[0] && !cuePrefs.muted) speak(`Starting ${plan.name}. ${plan.steps[0].label}.`);
  await retune();
}

export async function pause() {
  if (!recorder) return;
  await recorder.record({ type: "pause", t: Date.now() });
  await retune();
}

export async function resume() {
  if (!recorder) return;
  await recorder.record({ type: "resume", t: Date.now() });
  await retune();
}

export async function finish() {
  if (!recorder) return;
  await recorder.record({ type: "finish", t: Date.now() });
  await recorder.flush();
  await stopUpdates();
  backgroundUpdates = false;
  Speech.stop();
  notify();
}

/** Put the finished run in the upload queue, then clear the journal. */
export async function save(name: string | null) {
  const r = recorder;
  if (!r || r.state.status !== "finished") return;
  const run = toQueuedRun(r.meta, r.state, name, Date.now());
  await syncQueue().enqueue(run); // durable before the journal is cleared
  await r.discard();
  recorder = null;
  cueState = null;
  notify();
  void syncQueue().processDue();
}

/** Throw the current recording away (runner confirmed). */
export async function discard() {
  await stopUpdates();
  await recorder?.discard();
  recorder = null;
  cueState = null;
  notify();
}

/** Resume location updates for a recovered, unfinished recording. */
export async function continueRecovered() {
  await retune();
}
