import { useEffect, useReducer, useState } from "react";
import * as session from "../native/session";
import { subscribeQueue, syncQueue } from "../native/sync";
import type { QueuedRun } from "../sync/queue";

/** Re-render when the recording session changes. */
export function useSession() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => session.subscribe(bump), []);
  return session.current();
}

/** A clock that ticks every `ms` while mounted (for live elapsed time). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useQueue() {
  const [runs, setRuns] = useState<QueuedRun[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void syncQueue()
        .list()
        .then((list) => {
          if (alive) setRuns(list);
        });
    load();
    const off = subscribeQueue(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return runs;
}
