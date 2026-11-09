/**
 * Durable upload queue for finished runs.
 *
 * - Every run carries a client-generated UUID (clientRef). The server stores
 *   at most one activity per runner and clientRef, so retrying is always safe:
 *   a run whose response was lost is simply confirmed on the next attempt.
 * - A run is never removed automatically before the server confirms it
 *   (synced). Only an explicit discard by the runner deletes an unsynced run.
 * - Failures retry with exponential backoff and jitter. A rejected run (the
 *   server says it is invalid) stops retrying until the runner asks.
 * - Uploads run one at a time; overlapping triggers share one pass.
 */

export type SyncStatus = "queued" | "uploading" | "synced" | "failed";

export type UploadPoint = { t: string; lat: number; lon: number; ele?: number | null; acc?: number | null };

export type RunSummary = {
  startedAt: number;
  distanceM: number;
  movingS: number;
  elapsedS: number;
  averagePace: number | null;
};

export type QueuedRun = {
  clientRef: string;
  activityType: "run" | "walk_run" | "walk" | "hike";
  name: string | null;
  createdAt: number;
  points: UploadPoint[];
  pauses: { from: string; to: string }[];
  summary: RunSummary;
  status: SyncStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /** The server rejected it; no automatic retries. */
  rejected: boolean;
  activityId: string | null;
  /** The server already had this run (e.g. imported from a watch). */
  duplicate: boolean;
};

export type UploadOutcome =
  | { kind: "synced"; activityId: string; duplicate: boolean }
  | { kind: "retry"; reason: string; retryAfterMs?: number }
  | { kind: "auth"; reason: string }
  | { kind: "rejected"; reason: string };

export interface QueueStore {
  list(): Promise<QueuedRun[]>;
  get(clientRef: string): Promise<QueuedRun | null>;
  put(run: QueuedRun): Promise<void>;
  remove(clientRef: string): Promise<void>;
}

export class MemoryQueueStore implements QueueStore {
  runs = new Map<string, QueuedRun>();
  async list() {
    return [...this.runs.values()].map((r) => structuredClone(r)).sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(ref: string) {
    const r = this.runs.get(ref);
    return r ? structuredClone(r) : null;
  }
  async put(run: QueuedRun) {
    this.runs.set(run.clientRef, structuredClone(run));
  }
  async remove(ref: string) {
    this.runs.delete(ref);
  }
}

export type BackoffOptions = { baseMs: number; maxMs: number };
export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 15_000, maxMs: 30 * 60_000 };

/** Exponential backoff with "equal jitter": half fixed, half random. */
export function backoffDelay(attempts: number, random: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp / 2 + (random * exp) / 2);
}

export type QueueDeps = {
  store: QueueStore;
  upload: (run: QueuedRun) => Promise<UploadOutcome>;
  now?: () => number;
  random?: () => number;
  backoff?: BackoffOptions;
  onChange?: () => void;
};

export function newQueuedRun(
  input: Pick<QueuedRun, "clientRef" | "activityType" | "name" | "points" | "pauses" | "summary">,
  now: number,
): QueuedRun {
  return {
    ...input,
    createdAt: now,
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    rejected: false,
    activityId: null,
    duplicate: false,
  };
}

export class UploadQueue {
  private running: Promise<void> | null = null;
  private now: () => number;
  private random: () => number;
  private backoff: BackoffOptions;

  constructor(private deps: QueueDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.backoff = deps.backoff ?? DEFAULT_BACKOFF;
  }

  /** Add a finished run. Idempotent: an existing entry with the same clientRef is kept. */
  async enqueue(run: QueuedRun) {
    const existing = await this.deps.store.get(run.clientRef);
    if (!existing) await this.deps.store.put(run);
    this.deps.onChange?.();
  }

  /** Every run, newest first, for the sync status list. */
  list(): Promise<QueuedRun[]> {
    return this.deps.store.list();
  }

  /** After a restart, an upload that was in flight is retried (the server deduplicates). */
  async recoverInterrupted() {
    for (const run of await this.deps.store.list()) {
      if (run.status === "uploading") await this.deps.store.put({ ...run, status: "queued" });
    }
  }

  /** The earliest time a pending run is due, or null when nothing is pending. */
  async nextDueAt(): Promise<number | null> {
    const due = (await this.deps.store.list()).filter((r) => r.status !== "synced" && !r.rejected);
    return due.length ? Math.min(...due.map((r) => r.nextAttemptAt)) : null;
  }

  /** Upload every due run once. Concurrent calls share the same pass. */
  processDue(): Promise<void> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async pass() {
    const runs = (await this.deps.store.list()).sort((a, b) => a.createdAt - b.createdAt);
    for (const run of runs) {
      if (run.status === "synced" || run.rejected || run.nextAttemptAt > this.now()) continue;
      const stop = await this.attempt(run);
      if (stop) break;
    }
  }

  /** Returns true when the pass should stop (signed out: every upload would fail). */
  private async attempt(run: QueuedRun): Promise<boolean> {
    const attempts = run.attempts + 1;
    await this.deps.store.put({ ...run, status: "uploading", attempts });
    this.deps.onChange?.();
    let outcome: UploadOutcome;
    try {
      outcome = await this.deps.upload(run);
    } catch (e) {
      outcome = { kind: "retry", reason: e instanceof Error ? e.message : "Upload failed." };
    }
    const now = this.now();
    let next: QueuedRun;
    switch (outcome.kind) {
      case "synced":
        // Confirmed by the server: the raw points are no longer needed.
        next = {
          ...run,
          attempts,
          status: "synced",
          activityId: outcome.activityId,
          duplicate: outcome.duplicate,
          lastError: null,
          points: [],
        };
        break;
      case "rejected":
        next = { ...run, attempts, status: "failed", rejected: true, lastError: outcome.reason };
        break;
      case "auth":
      case "retry": {
        const delay = Math.max(
          backoffDelay(attempts, this.random(), this.backoff),
          outcome.kind === "retry" ? (outcome.retryAfterMs ?? 0) : 0,
        );
        next = { ...run, attempts, status: "failed", lastError: outcome.reason, nextAttemptAt: now + delay };
        break;
      }
    }
    await this.deps.store.put(next);
    this.deps.onChange?.();
    return outcome.kind === "auth";
  }

  /** The runner asked to try again now (also clears a rejection). */
  async retryNow(clientRef: string) {
    const run = await this.deps.store.get(clientRef);
    if (!run || run.status === "synced") return;
    await this.deps.store.put({ ...run, status: "queued", rejected: false, nextAttemptAt: this.now() });
    this.deps.onChange?.();
    await this.processDue();
  }

  /** Explicit, runner-confirmed deletion of a run that is not on the server. */
  async discard(clientRef: string) {
    const run = await this.deps.store.get(clientRef);
    if (!run || run.status === "uploading") return false;
    await this.deps.store.remove(clientRef);
    this.deps.onChange?.();
    return true;
  }

  /** Remove a synced run from the local history (the activity stays on the server). */
  async forgetSynced(clientRef: string) {
    const run = await this.deps.store.get(clientRef);
    if (run?.status !== "synced") return false;
    await this.deps.store.remove(clientRef);
    this.deps.onChange?.();
    return true;
  }
}
