/**
 * Client for POST /api/v1/activities/recorded. Turns HTTP results into queue
 * outcomes. Pure apart from the injected fetch.
 */
import type { QueuedRun, UploadOutcome } from "./queue";

export const RECORDED_PATH = "/api/v1/activities/recorded";

export function uploadBody(run: QueuedRun) {
  return {
    clientRef: run.clientRef,
    activityType: run.activityType,
    name: run.name ?? undefined,
    points: run.points,
    pauses: run.pauses,
  };
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export async function uploadRecordedRun(
  fetchFn: FetchLike,
  baseUrl: string,
  accessToken: string | null,
  run: QueuedRun,
): Promise<UploadOutcome> {
  if (!accessToken) return { kind: "auth", reason: "Sign in to upload." };
  let res;
  try {
    res = await fetchFn(`${baseUrl.replace(/\/$/, "")}${RECORDED_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(uploadBody(run)),
    });
  } catch {
    return { kind: "retry", reason: "No connection to HYD Runners." };
  }
  let body: { data?: { status?: string; activityId?: string }; error?: { message?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-JSON (e.g. a proxy error page) */
  }
  const message = body.error?.message;
  if ((res.status === 200 || res.status === 201) && body.data?.activityId) {
    return { kind: "synced", activityId: body.data.activityId, duplicate: body.data.status === "duplicate" };
  }
  if (res.status === 202)
    return { kind: "retry", reason: "The server is still processing this run.", retryAfterMs: 30_000 };
  if (res.status === 401) return { kind: "auth", reason: "Sign in again to upload." };
  if (res.status === 429) {
    return {
      kind: "retry",
      reason: message ?? "Too many uploads. Retrying later.",
      retryAfterMs: retryAfterMs(res.headers.get("retry-after")) ?? 10 * 60_000,
    };
  }
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    return { kind: "rejected", reason: message ?? "The server could not accept this run." };
  }
  return { kind: "retry", reason: message ?? `Server error (${res.status}).` };
}
