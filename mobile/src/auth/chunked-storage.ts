/**
 * Supabase auth storage on top of a small key-value store (expo-secure-store
 * on device). Secure store values should stay under ~2 KB, and a Supabase
 * session (access + refresh token + user) can exceed that, so values are split
 * into chunks: `<key>.n` holds the chunk count, `<key>.0`… the parts.
 */
export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;

/** Secure store keys may only contain letters, digits, ".", "-" and "_". */
export const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export function chunkedStorage(kv: KeyValue, chunkSize = CHUNK_SIZE) {
  const countKey = (k: string) => `${safeKey(k)}.n`;
  const partKey = (k: string, i: number) => `${safeKey(k)}.${i}`;

  async function removeItem(key: string) {
    const n = Number((await kv.getItem(countKey(key))) ?? 0);
    // Remove the count first: a crash mid-way leaves orphans, never a torn value.
    await kv.removeItem(countKey(key));
    for (let i = 0; i < n; i++) await kv.removeItem(partKey(key, i));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await kv.getItem(countKey(key));
      if (raw === null) return null;
      const n = Number(raw);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await kv.getItem(partKey(key, i));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const n = Math.max(1, Math.ceil(value.length / chunkSize));
      for (let i = 0; i < n; i++) await kv.setItem(partKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      // Written last: the value only becomes visible once every part exists.
      await kv.setItem(countKey(key), String(n));
    },
    removeItem,
  };
}
