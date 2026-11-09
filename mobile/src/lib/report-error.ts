/**
 * Crash and error reporting. Deliberately tiny and local: errors go to the
 * console in development and to an in-memory ring buffer (shown under
 * Settings → Diagnostics) in every build. No third-party service is used; to
 * add one later, forward from `reportError` only.
 */
export type ErrorEntry = { at: number; context: string; message: string };

const MAX = 50;
const entries: ErrorEntry[] = [];
const isDev = (globalThis as { __DEV__?: boolean }).__DEV__ ?? false;

export function reportError(error: unknown, context = "app") {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  entries.push({ at: Date.now(), context, message });
  if (entries.length > MAX) entries.shift();
  if (isDev) console.error(`[${context}]`, error);
}

export function recentErrors(): readonly ErrorEntry[] {
  return entries;
}
