import type { Fix } from "./filter";

export const T0 = Date.parse("2026-11-20T00:30:00Z");
const M_PER_DEG_LAT = 111_195;

/** Fixes every `stepS` seconds heading north at `speedMs`, from `startS` seconds after T0. */
export function line(opts: {
  seconds: number;
  speedMs: number;
  stepS?: number;
  startS?: number;
  fromM?: number;
  acc?: number;
}): Fix[] {
  const step = opts.stepS ?? 2;
  const startS = opts.startS ?? 0;
  const out: Fix[] = [];
  for (let s = 0; s <= opts.seconds; s += step) {
    out.push({
      t: T0 + (startS + s) * 1000,
      lat: 17.42 + ((opts.fromM ?? 0) + opts.speedMs * s) / M_PER_DEG_LAT,
      lon: 78.42,
      acc: opts.acc ?? 5,
    });
  }
  return out;
}
