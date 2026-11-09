/**
 * Incremental persistence of the in-progress recording.
 *
 * The recorder's events are appended to a durable store (SQLite on device,
 * memory in tests). Fixes are buffered and flushed every `flushEvery` fixes or
 * `flushAfterMs`; state changes (start, pause, resume, finish) flush at once.
 * After a crash or an OS kill at most one buffer of fixes is lost, and
 * `recover()` rebuilds the recorder by replaying what was stored.
 */
import { applyMutable, initialState, replay, type RecorderEvent, type RecorderState } from "./recorder";
import type { FilterOptions } from "./filter";
import { DEFAULT_FILTER } from "./filter";

export type RecordingMeta = {
  /** Client-generated UUID; becomes the upload's clientRef. */
  clientRef: string;
  activityType: "run" | "walk_run" | "walk" | "hike";
  /** Planned workout id, if any. */
  workoutId: string | null;
  createdAt: number;
};

/** Durable storage for exactly one in-progress recording. */
export interface JournalStore {
  begin(meta: RecordingMeta): Promise<void>;
  append(events: readonly RecorderEvent[]): Promise<void>;
  load(): Promise<{ meta: RecordingMeta; events: RecorderEvent[] } | null>;
  clear(): Promise<void>;
}

export class MemoryJournalStore implements JournalStore {
  meta: RecordingMeta | null = null;
  events: RecorderEvent[] = [];
  async begin(meta: RecordingMeta) {
    this.meta = meta;
    this.events = [];
  }
  async append(events: readonly RecorderEvent[]) {
    if (!this.meta) throw new Error("No recording in progress.");
    this.events.push(...events.map((e) => structuredClone(e)));
  }
  async load() {
    return this.meta ? { meta: this.meta, events: this.events.map((e) => structuredClone(e)) } : null;
  }
  async clear() {
    this.meta = null;
    this.events = [];
  }
}

export type JournalOptions = { flushEvery: number; flushAfterMs: number; filter: FilterOptions };
const DEFAULTS: JournalOptions = { flushEvery: 5, flushAfterMs: 10_000, filter: DEFAULT_FILTER };

/**
 * A recorder whose events are journaled. Methods are serialised through a
 * promise chain so the background task and the UI can both feed it.
 */
export class JournaledRecorder {
  state: RecorderState;
  meta: RecordingMeta;
  private buffer: RecorderEvent[] = [];
  private lastFlush: number;
  private chain: Promise<void> = Promise.resolve();
  private opts: JournalOptions;

  private constructor(
    private store: JournalStore,
    meta: RecordingMeta,
    state: RecorderState,
    opts: Partial<JournalOptions>,
    now: number,
  ) {
    this.meta = meta;
    this.state = state;
    this.opts = { ...DEFAULTS, ...opts };
    this.lastFlush = now;
  }

  /** Start a new recording (replacing any stored one) and record the start event. */
  static async start(store: JournalStore, meta: RecordingMeta, now: number, opts: Partial<JournalOptions> = {}) {
    await store.begin(meta);
    const r = new JournaledRecorder(store, meta, initialState(), opts, now);
    await r.record({ type: "start", t: now });
    return r;
  }

  /** Rebuild the stored recording, if there is one. */
  static async recover(store: JournalStore, now: number, opts: Partial<JournalOptions> = {}) {
    const saved = await store.load();
    if (!saved) return null;
    const merged = { ...DEFAULTS, ...opts };
    return new JournaledRecorder(store, saved.meta, replay(saved.events, merged.filter), merged, now);
  }

  /** Apply an event and persist it (fixes are buffered). */
  record(event: RecorderEvent, now = eventTime(event)): Promise<void> {
    this.state = applyMutable(this.state, event, this.opts.filter);
    this.buffer.push(event);
    const urgent = event.type !== "fix";
    if (urgent || this.buffer.length >= this.opts.flushEvery || now - this.lastFlush >= this.opts.flushAfterMs) {
      return this.flush(now);
    }
    return this.chain;
  }

  flush(now = Date.now()): Promise<void> {
    if (this.buffer.length === 0) return this.chain;
    const batch = this.buffer;
    this.buffer = [];
    this.lastFlush = now;
    this.chain = this.chain.then(() => this.store.append(batch));
    return this.chain;
  }

  /** Forget the recording (after it is safely in the upload queue, or discarded). */
  async discard() {
    this.buffer = [];
    await this.chain.catch(() => undefined);
    await this.store.clear();
  }

  get pendingEvents() {
    return this.buffer.length;
  }
}

function eventTime(e: RecorderEvent) {
  return e.type === "fix" ? e.fix.t : e.t;
}
