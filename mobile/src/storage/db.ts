/**
 * On-device storage (expo-sqlite): the in-progress recording journal, the
 * upload queue and small preferences. WAL mode so the background location task
 * and the UI can write without blocking each other.
 */
import * as SQLite from "expo-sqlite";
import type { JournalStore, RecordingMeta } from "../recording/journal";
import type { RecorderEvent } from "../recording/recorder";
import type { QueueStore, QueuedRun } from "../sync/queue";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("hydr.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS recording_meta (id INTEGER PRIMARY KEY CHECK (id = 1), meta TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recording_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS upload_queue (
        client_ref TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL,
        run TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    return d;
  })();
  return dbPromise;
}

export class SqliteJournalStore implements JournalStore {
  async begin(meta: RecordingMeta) {
    const d = await db();
    await d.withTransactionAsync(async () => {
      await d.runAsync("DELETE FROM recording_events");
      await d.runAsync("INSERT OR REPLACE INTO recording_meta (id, meta) VALUES (1, ?)", JSON.stringify(meta));
    });
  }
  async append(events: readonly RecorderEvent[]) {
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const e of events) await d.runAsync("INSERT INTO recording_events (event) VALUES (?)", JSON.stringify(e));
    });
  }
  async load() {
    const d = await db();
    const meta = await d.getFirstAsync<{ meta: string }>("SELECT meta FROM recording_meta WHERE id = 1");
    if (!meta) return null;
    const rows = await d.getAllAsync<{ event: string }>("SELECT event FROM recording_events ORDER BY seq");
    return {
      meta: JSON.parse(meta.meta) as RecordingMeta,
      events: rows.map((r) => JSON.parse(r.event) as RecorderEvent),
    };
  }
  async clear() {
    const d = await db();
    await d.withTransactionAsync(async () => {
      await d.runAsync("DELETE FROM recording_events");
      await d.runAsync("DELETE FROM recording_meta");
    });
  }
}

export class SqliteQueueStore implements QueueStore {
  async list() {
    const d = await db();
    const rows = await d.getAllAsync<{ run: string }>("SELECT run FROM upload_queue ORDER BY created_at DESC");
    return rows.map((r) => JSON.parse(r.run) as QueuedRun);
  }
  async get(clientRef: string) {
    const d = await db();
    const row = await d.getFirstAsync<{ run: string }>("SELECT run FROM upload_queue WHERE client_ref = ?", clientRef);
    return row ? (JSON.parse(row.run) as QueuedRun) : null;
  }
  async put(run: QueuedRun) {
    const d = await db();
    await d.runAsync(
      "INSERT OR REPLACE INTO upload_queue (client_ref, created_at, run) VALUES (?, ?, ?)",
      run.clientRef,
      run.createdAt,
      JSON.stringify(run),
    );
  }
  async remove(clientRef: string) {
    const d = await db();
    await d.runAsync("DELETE FROM upload_queue WHERE client_ref = ?", clientRef);
  }
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>("SELECT value FROM prefs WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as T) };
  } catch {
    return fallback;
  }
}

export async function setPref<T>(key: string, value: T) {
  const d = await db();
  await d.runAsync("INSERT OR REPLACE INTO prefs (key, value) VALUES (?, ?)", key, JSON.stringify(value));
}
