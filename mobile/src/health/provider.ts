/**
 * Health platform boundary. HYD Runners reads (never writes) workouts from
 * Health Connect (Android) or HealthKit (iOS) so a runner can see runs
 * recorded by other apps or watches. Only exercise sessions, routes and
 * distance are requested.
 *
 * Both adapters need a development build on a real device (they are native
 * modules, unavailable in Expo Go and simulators without health data). They
 * are type-checked here but UNTESTED on devices; see docs/mobile.md.
 */
export type HealthWorkout = {
  /** Platform record id. */
  id: string;
  activityType: "run" | "walk" | "hike" | "other";
  startedAt: string;
  endedAt: string;
  distanceM: number | null;
  /** Source app or device, if the platform reports it. */
  source: string | null;
};

export type HealthAvailability = "available" | "not_installed" | "unsupported";

export interface HealthProvider {
  readonly platform: "health_connect" | "healthkit" | "none";
  availability(): Promise<HealthAvailability>;
  /** Ask for read access to exercise sessions, routes and distance. Returns whether access was granted. */
  requestPermissions(): Promise<boolean>;
  hasPermissions(): Promise<boolean>;
  /** Workouts that started at or after `since`. */
  readWorkouts(since: Date): Promise<HealthWorkout[]>;
  /**
   * Revoke this app's access. Health Connect supports it in-app; HealthKit
   * does not (iOS only lets the user change it in Settings → Health), so the
   * iOS adapter opens Settings and returns false.
   */
  revoke(): Promise<boolean>;
}

/** Used on platforms without a health store, and when the native module is missing. */
export const unsupportedHealth: HealthProvider = {
  platform: "none",
  availability: async () => "unsupported",
  requestPermissions: async () => false,
  hasPermissions: async () => false,
  readWorkouts: async () => [],
  revoke: async () => false,
};
