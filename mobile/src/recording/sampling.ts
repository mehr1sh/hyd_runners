/**
 * Battery-aware location sampling. Pure policy; the native layer maps it to
 * expo-location options.
 *
 * - Foreground (screen on, app visible): high accuracy, a fix every ~2 s or
 *   5 m, so the live pace is responsive.
 * - Background / screen off: balanced accuracy (Wi-Fi/cell assisted where
 *   available) with a 10 m distance interval and deferred delivery, which
 *   lets the OS batch fixes and keep the GPS radio idle more of the time.
 *   Distance stays close because fixes still arrive every 10 m of movement.
 * - Paused: low accuracy, sparse fixes, only to keep the signal indicator
 *   alive and the foreground service running.
 */
export type SamplingMode = "foreground" | "background" | "paused";

export type SamplingPolicy = {
  accuracy: "high" | "balanced" | "low";
  timeIntervalMs: number;
  distanceIntervalM: number;
  /** iOS/Android may batch deliveries up to this long. */
  deferredUpdatesIntervalMs: number;
};

export function samplingPolicy(mode: SamplingMode): SamplingPolicy {
  switch (mode) {
    case "foreground":
      return { accuracy: "high", timeIntervalMs: 2000, distanceIntervalM: 5, deferredUpdatesIntervalMs: 0 };
    case "background":
      return { accuracy: "balanced", timeIntervalMs: 5000, distanceIntervalM: 10, deferredUpdatesIntervalMs: 30_000 };
    case "paused":
      return { accuracy: "low", timeIntervalMs: 30_000, distanceIntervalM: 50, deferredUpdatesIntervalMs: 60_000 };
  }
}

export function samplingMode(appActive: boolean, paused: boolean): SamplingMode {
  if (paused) return "paused";
  return appActive ? "foreground" : "background";
}
