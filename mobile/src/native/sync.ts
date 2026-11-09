/**
 * Runs the upload queue: on launch, when connectivity returns, when the app
 * comes to the foreground and on a timer for the next due retry.
 */
import * as Network from "expo-network";
import { AppState } from "react-native";
import { accessToken } from "../auth/supabase";
import { config } from "../config";
import { reportError } from "../lib/report-error";
import { SqliteQueueStore } from "../storage/db";
import { uploadRecordedRun } from "../sync/api";
import { UploadQueue } from "../sync/queue";

const listeners = new Set<() => void>();
let queue: UploadQueue | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export function syncQueue(): UploadQueue {
  queue ??= new UploadQueue({
    store: new SqliteQueueStore(),
    upload: async (run) => uploadRecordedRun(fetch, config.apiBaseUrl, await accessToken(), run),
    onChange: () => {
      for (const l of listeners) l();
    },
  });
  return queue;
}

export function subscribeQueue(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function online() {
  try {
    const s = await Network.getNetworkStateAsync();
    return Boolean(s.isConnected && s.isInternetReachable !== false);
  } catch {
    return true; // let the request decide
  }
}

/** Upload what is due (if online), then schedule the next attempt. */
export async function kick() {
  try {
    if (await online()) await syncQueue().processDue();
  } catch (e) {
    reportError(e, "sync");
  }
  if (timer) clearTimeout(timer);
  const due = await syncQueue().nextDueAt();
  if (due !== null) timer = setTimeout(() => void kick(), Math.max(5_000, due - Date.now()));
}

export async function startSync() {
  if (started) return;
  started = true;
  await syncQueue().recoverInterrupted();
  Network.addNetworkStateListener((s) => {
    if (s.isConnected) void kick();
  });
  AppState.addEventListener("change", (s) => {
    if (s === "active") void kick();
  });
  await kick();
}
