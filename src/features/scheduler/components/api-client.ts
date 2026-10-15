import type { ErrorCode } from "@/lib/contracts";

export type ApiFailure = { code: ErrorCode | "network_error"; message: string; details?: unknown };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** Calls a `/api/v1` endpoint with the cookie session and unwraps the `{ data } | { error }` envelope. */
export async function callApi<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return {
      ok: false,
      error: { code: "network_error", message: "You appear to be offline. Check your connection and try again." },
    };
  }
  let body: { data?: T; error?: ApiFailure } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body && "data" in body) return { ok: true, data: body.data as T };
  return {
    ok: false,
    error: body?.error ?? { code: "internal_error", message: "Something went wrong. Please try again." },
  };
}

/** PUT a file to a signed Storage upload URL, reporting progress (0–100). */
export function uploadWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}
