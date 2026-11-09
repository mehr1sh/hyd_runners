/**
 * HealthKit adapter (iOS, @kingstinct/react-native-healthkit).
 * Requires a development build on a real iPhone with the HealthKit
 * entitlement. UNTESTED on devices in this repository.
 *
 * HealthKit never reveals whether read access was denied (privacy by design),
 * so hasPermissions() can only say whether the prompt was shown.
 */
import {
  WorkoutActivityType,
  isHealthDataAvailable,
  queryWorkoutSamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import { Linking } from "react-native";
import { reportError } from "../lib/report-error";
import { getPref, setPref } from "../storage/db";
import type { HealthProvider, HealthWorkout } from "./provider";

// Read-only: workouts, their routes and running/walking distance.
const READ = [
  "HKWorkoutTypeIdentifier",
  "HKWorkoutRouteTypeIdentifier",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
] as const;

const typeOf = (t: WorkoutActivityType): HealthWorkout["activityType"] =>
  t === WorkoutActivityType.running
    ? "run"
    : t === WorkoutActivityType.walking
      ? "walk"
      : t === WorkoutActivityType.hiking
        ? "hike"
        : "other";

const toMeters = (q: { unit: string; quantity: number } | undefined) => {
  if (!q) return null;
  if (q.unit === "m") return q.quantity;
  if (q.unit === "km") return q.quantity * 1000;
  if (q.unit === "mi") return q.quantity * 1609.344;
  return null;
};

export const healthKit: HealthProvider = {
  platform: "healthkit",
  async availability() {
    try {
      return isHealthDataAvailable() ? "available" : "unsupported";
    } catch (e) {
      reportError(e, "healthkit");
      return "unsupported";
    }
  },
  async requestPermissions() {
    const ok = await requestAuthorization({ toRead: READ });
    if (ok) await setPref("healthkit", { asked: true });
    return ok;
  },
  async hasPermissions() {
    return (await getPref("healthkit", { asked: false })).asked;
  },
  async readWorkouts(since) {
    const workouts = await queryWorkoutSamples({ limit: 0, ascending: false, filter: { date: { startDate: since } } });
    return workouts.map((w) => ({
      id: w.uuid,
      activityType: typeOf(w.workoutActivityType),
      startedAt: new Date(w.startDate).toISOString(),
      endedAt: new Date(w.endDate).toISOString(),
      distanceM: toMeters(w.totalDistance),
      source: (w as { sourceRevision?: { source?: { name?: string } } }).sourceRevision?.source?.name ?? null,
    }));
  },
  async revoke() {
    // iOS has no API to revoke HealthKit access; the runner does it in Settings → Health.
    await Linking.openSettings();
    return false;
  },
};
