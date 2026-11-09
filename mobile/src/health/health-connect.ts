/**
 * Health Connect adapter (Android, react-native-health-connect).
 * Requires a development build and a device with Health Connect. UNTESTED on
 * devices in this repository.
 */
import {
  ExerciseType,
  SdkAvailabilityStatus,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  revokeAllPermissions,
  type Permission,
} from "react-native-health-connect";
import { reportError } from "../lib/report-error";
import type { HealthProvider, HealthWorkout } from "./provider";

// Read-only, and only what HYD Runners uses. Routes are consented per session
// by Health Connect itself when a route is first read.
const PERMISSIONS: Permission[] = [
  { accessType: "read", recordType: "ExerciseSession" },
  { accessType: "read", recordType: "Distance" },
];

let initialized = false;
async function ready() {
  if (!initialized) initialized = await initialize();
  return initialized;
}

const typeOf = (exerciseType: number): HealthWorkout["activityType"] =>
  exerciseType === ExerciseType.RUNNING || exerciseType === ExerciseType.RUNNING_TREADMILL
    ? "run"
    : exerciseType === ExerciseType.WALKING
      ? "walk"
      : exerciseType === ExerciseType.HIKING
        ? "hike"
        : "other";

export const healthConnect: HealthProvider = {
  platform: "health_connect",
  async availability() {
    try {
      const status = await getSdkStatus();
      if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
      if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "not_installed";
      return "unsupported";
    } catch (e) {
      reportError(e, "health-connect");
      return "unsupported";
    }
  },
  async requestPermissions() {
    if (!(await ready())) return false;
    const granted = await requestPermission(PERMISSIONS);
    return PERMISSIONS.every((p) =>
      granted.some((g) => g.accessType === p.accessType && g.recordType === p.recordType),
    );
  },
  async hasPermissions() {
    if (!(await ready())) return false;
    const granted = await getGrantedPermissions();
    return granted.some((g) => g.recordType === "ExerciseSession" && g.accessType === "read");
  },
  async readWorkouts(since) {
    if (!(await ready())) return [];
    const out: HealthWorkout[] = [];
    let pageToken: string | undefined;
    do {
      const page = await readRecords("ExerciseSession", {
        timeRangeFilter: { operator: "after", startTime: since.toISOString() },
        pageToken,
      });
      for (const r of page.records) {
        out.push({
          id: r.metadata?.id ?? `${r.startTime}`,
          activityType: typeOf(r.exerciseType),
          startedAt: r.startTime,
          endedAt: r.endTime,
          distanceM: null, // Distance records are separate; aggregate per session when needed.
          source: r.metadata?.dataOrigin ?? null,
        });
      }
      pageToken = page.pageToken || undefined;
    } while (pageToken);
    return out;
  },
  async revoke() {
    if (!(await ready())) return false;
    await revokeAllPermissions();
    return true;
  },
};
