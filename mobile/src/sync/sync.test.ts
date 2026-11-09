import { describe, expect, it, vi } from "vitest";
import { chunkedStorage, safeKey, type KeyValue } from "../auth/chunked-storage";
import { uploadRecordedRun } from "./api";
import { MemoryQueueStore, UploadQueue, backoffDelay, newQueuedRun, type QueuedRun, type UploadOutcome } from "./queue";

const T0 = Date.parse("2026-11-20T00:30:00Z");

function run(ref: string, createdAt = T0): QueuedRun {
  return newQueuedRun(
    {
      clientRef: ref,
      activityType: "run",
      name: null,
      points: [
        { t: "2026-11-20T00:30:00.000Z", lat: 17.42, lon: 78.42 },
        { t: "2026-11-20T00:40:00.000Z", lat: 17.44, lon: 78.42 },
      ],
      pauses: [],
      summary: { startedAt: T0, distanceM: 2200, movingS: 600, elapsedS: 600, averagePace: 272 },
    },
    createdAt,
  );
}

function setup(outcomes: UploadOutcome[]) {
  let now = T0;
  const store = new MemoryQueueStore();
  const upload = vi.fn(async (): Promise<UploadOutcome> => outcomes.shift() ?? { kind: "retry", reason: "no more" });
  const queue = new UploadQueue({ store, upload, now: () => now, random: () => 0.5 });
  return { store, upload, queue, advance: (ms: number) => (now += ms), now: () => now };
}

describe("upload queue", () => {
  it("uploads a queued run and keeps it as synced with the server id", async () => {
    const { store, queue } = setup([{ kind: "synced", activityId: "act-1", duplicate: false }]);
    await queue.enqueue(run("r1"));
    await queue.processDue();
    const r = await store.get("r1");
    expect(r).toMatchObject({ status: "synced", activityId: "act-1", attempts: 1, lastError: null });
    // The raw track is dropped only after the server confirmed it.
    expect(r!.points).toEqual([]);
  });

  it("retries with exponential backoff and never deletes before the server confirms", async () => {
    const { store, queue, upload, advance } = setup([
      { kind: "retry", reason: "No connection to HYD Runners." },
      { kind: "retry", reason: "Server error (503)." },
      { kind: "synced", activityId: "act-2", duplicate: false },
    ]);
    await queue.enqueue(run("r2"));
    await queue.processDue();
    let r = await store.get("r2");
    expect(r).toMatchObject({ status: "failed", attempts: 1, lastError: "No connection to HYD Runners." });
    expect(r!.points).toHaveLength(2);
    expect(r!.nextAttemptAt - T0).toBe(backoffDelay(1, 0.5));

    // Not due yet: nothing happens.
    await queue.processDue();
    expect(upload).toHaveBeenCalledTimes(1);

    advance(backoffDelay(1, 0.5));
    await queue.processDue();
    r = await store.get("r2");
    expect(r).toMatchObject({ status: "failed", attempts: 2 });
    expect(r!.nextAttemptAt - (T0 + backoffDelay(1, 0.5))).toBe(backoffDelay(2, 0.5));

    advance(backoffDelay(2, 0.5));
    await queue.processDue();
    expect(await store.get("r2")).toMatchObject({ status: "synced", activityId: "act-2", attempts: 3 });
  });

  it("grows the delay exponentially with jitter, capped", () => {
    expect(backoffDelay(1, 0)).toBe(7_500);
    expect(backoffDelay(1, 1)).toBe(15_000);
    expect(backoffDelay(3, 1)).toBe(60_000);
    expect(backoffDelay(30, 1)).toBe(30 * 60_000);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const { store, queue } = setup([{ kind: "retry", reason: "Too many", retryAfterMs: 600_000 }]);
    await queue.enqueue(run("r3"));
    await queue.processDue();
    expect((await store.get("r3"))!.nextAttemptAt).toBe(T0 + 600_000);
  });

  it("stops retrying a rejected run until the runner asks", async () => {
    const { store, queue, upload, advance } = setup([
      { kind: "rejected", reason: "The activity is shorter than a minute." },
      { kind: "rejected", reason: "The activity is shorter than a minute." },
    ]);
    await queue.enqueue(run("r4"));
    await queue.processDue();
    advance(24 * 3600_000);
    await queue.processDue();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await store.get("r4")).toMatchObject({ status: "failed", rejected: true });
    await queue.retryNow("r4");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(await queue.discard("r4")).toBe(true);
    expect(await store.get("r4")).toBeNull();
  });

  it("stops the pass when signed out", async () => {
    const { queue, upload } = setup([{ kind: "auth", reason: "Sign in again to upload." }]);
    await queue.enqueue(run("a", T0));
    await queue.enqueue(run("b", T0 + 1));
    await queue.processDue();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: enqueueing the same clientRef twice keeps one entry", async () => {
    const { store, queue } = setup([]);
    await queue.enqueue(run("same"));
    await queue.enqueue({ ...run("same"), name: "changed" });
    expect(await store.list()).toHaveLength(1);
    expect((await store.get("same"))!.name).toBeNull();
  });

  it("shares one pass between overlapping triggers (no double upload)", async () => {
    const { queue, upload } = setup([{ kind: "synced", activityId: "x", duplicate: false }]);
    await queue.enqueue(run("c"));
    await Promise.all([queue.processDue(), queue.processDue(), queue.processDue()]);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("retries an upload interrupted by a crash with the same clientRef", async () => {
    const { store, queue, upload } = setup([{ kind: "synced", activityId: "act-5", duplicate: false }]);
    await store.put({ ...run("crash"), status: "uploading", attempts: 1 });
    await queue.recoverInterrupted();
    await queue.processDue();
    expect(upload.mock.calls[0]).toEqual([expect.objectContaining({ clientRef: "crash" })]);
    expect(await store.get("crash")).toMatchObject({ status: "synced", attempts: 2 });
  });

  it("treats an upload exception as retryable", async () => {
    const store = new MemoryQueueStore();
    const queue = new UploadQueue({
      store,
      upload: async () => Promise.reject(new Error("boom")),
      now: () => T0,
      random: () => 0,
    });
    await queue.enqueue(run("e"));
    await queue.processDue();
    expect(await store.get("e")).toMatchObject({ status: "failed", lastError: "boom", rejected: false });
  });

  it("forgets only synced runs", async () => {
    const { queue } = setup([]);
    await queue.enqueue(run("f"));
    expect(await queue.forgetSynced("f")).toBe(false);
  });
});

describe("API client", () => {
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });

  it("sends the run with the bearer token", async () => {
    const fetchFn = vi.fn(async () => res(201, { data: { status: "ready", activityId: "a1", created: true } }));
    const out = await uploadRecordedRun(fetchFn, "https://example.test/", "tok", run("r"));
    expect(out).toEqual({ kind: "synced", activityId: "a1", duplicate: false });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://example.test/api/v1/activities/recorded");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toMatchObject({ clientRef: "r", activityType: "run", pauses: [] });
  });

  it("classifies responses", async () => {
    const call = (r: ReturnType<typeof res>) => uploadRecordedRun(async () => r, "https://x", "tok", run("r"));
    expect(await call(res(200, { data: { status: "ready", activityId: "a" } }))).toMatchObject({ kind: "synced" });
    expect(await call(res(200, { data: { status: "duplicate", activityId: "a" } }))).toEqual({
      kind: "synced",
      activityId: "a",
      duplicate: true,
    });
    expect(await call(res(202, { data: { status: "processing" } }))).toMatchObject({ kind: "retry" });
    expect(await call(res(401, { error: { message: "Sign in" } }))).toMatchObject({ kind: "auth" });
    expect(await call(res(422, { error: { message: "Too short." } }))).toEqual({
      kind: "rejected",
      reason: "Too short.",
    });
    expect(await call(res(429, {}, { "retry-after": "120" }))).toMatchObject({ kind: "retry", retryAfterMs: 120_000 });
    expect(await call(res(500, { error: { message: "Oops" } }))).toEqual({ kind: "retry", reason: "Oops" });
    expect(
      await uploadRecordedRun(async () => Promise.reject(new TypeError("Network")), "https://x", "tok", run("r")),
    ).toMatchObject({ kind: "retry" });
    expect(await uploadRecordedRun(async () => res(200, {}), "https://x", null, run("r"))).toMatchObject({
      kind: "auth",
    });
  });
});

describe("chunked secure storage", () => {
  function memory(): KeyValue & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => void data.set(k, v),
      removeItem: async (k) => void data.delete(k),
    };
  }

  it("round-trips large values in small chunks", async () => {
    const kv = memory();
    const s = chunkedStorage(kv, 100);
    const value = "x".repeat(350);
    await s.setItem("sb-auth-token", value);
    expect(await s.getItem("sb-auth-token")).toBe(value);
    expect([...kv.data.values()].every((v) => v.length <= 100)).toBe(true);
    await s.setItem("sb-auth-token", "short");
    expect(await s.getItem("sb-auth-token")).toBe("short");
    expect(kv.data.size).toBe(2);
    await s.removeItem("sb-auth-token");
    expect(kv.data.size).toBe(0);
    expect(await s.getItem("sb-auth-token")).toBeNull();
  });

  it("uses keys the secure store accepts", () => {
    expect(safeKey("sb-abc:auth/token")).toBe("sb-abc_auth_token");
  });
});
