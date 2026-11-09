/**
 * Location plumbing: permissions, the background location task and
 * battery-aware sampling.
 *
 * With background permission, all fixes (foreground and background) come
 * from one expo-location task, so nothing is counted twice. On Android it runs
 * as a foreground service with a persistent notification; on iOS it uses the
 * "location" background mode with the blue status-bar indicator. Without
 * background permission the app records only while it is on screen
 * (watchPositionAsync) and says so.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Linking } from "react-native";
import type { Fix } from "../recording/filter";
import { samplingPolicy, type SamplingMode } from "../recording/sampling";
import { reportError } from "../lib/report-error";

export const LOCATION_TASK = "hydr-run-location";

export type PermissionState = "granted" | "denied" | "undetermined";
export type LocationPermissions = { foreground: PermissionState; background: PermissionState; canAskAgain: boolean };

const asState = (r: Location.LocationPermissionResponse): PermissionState =>
  r.granted ? "granted" : r.status === Location.PermissionStatus.UNDETERMINED ? "undetermined" : "denied";

export async function getLocationPermissions(): Promise<LocationPermissions> {
  const fg = await Location.getForegroundPermissionsAsync();
  let bg: PermissionState = "undetermined";
  try {
    bg = asState(await Location.getBackgroundPermissionsAsync());
  } catch (e) {
    reportError(e, "permissions");
  }
  return { foreground: asState(fg), background: bg, canAskAgain: fg.canAskAgain };
}

/** Ask for "while using the app" location. Call only after the explanation screen. */
export async function requestForeground(): Promise<PermissionState> {
  return asState(await Location.requestForegroundPermissionsAsync());
}

/** Ask for background ("Allow all the time") location, separately, after its own explanation. */
export async function requestBackground(): Promise<PermissionState> {
  return asState(await Location.requestBackgroundPermissionsAsync());
}

export function openOsSettings() {
  return Linking.openSettings();
}

export function toFix(l: Location.LocationObject): Fix {
  return {
    t: l.timestamp,
    lat: l.coords.latitude,
    lon: l.coords.longitude,
    acc: l.coords.accuracy,
    ele: l.coords.altitude,
    speed: l.coords.speed,
  };
}

const ACCURACY = {
  high: Location.Accuracy.BestForNavigation,
  balanced: Location.Accuracy.Balanced,
  low: Location.Accuracy.Low,
} as const;

type FixSink = (fixes: Fix[]) => void;
let sink: FixSink | null = null;
let watcher: Location.LocationSubscription | null = null;

/** Where fixes go. Set by the recording session at module load (also in a headless task run). */
export function setFixSink(fn: FixSink) {
  sink = fn;
}

// Must be defined at module scope so the OS can deliver updates after a relaunch.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    reportError(error, "location-task");
    return;
  }
  if (data?.locations?.length) sink?.(data.locations.map(toFix));
});

/** Start or retune location updates for the given sampling mode. Returns whether background updates are on. */
export async function startUpdates(mode: SamplingMode): Promise<{ background: boolean }> {
  const p = samplingPolicy(mode);
  const perms = await getLocationPermissions();
  if (perms.background === "granted") {
    if (watcher) {
      watcher.remove();
      watcher = null;
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: ACCURACY[p.accuracy],
      timeInterval: p.timeIntervalMs,
      distanceInterval: p.distanceIntervalM,
      deferredUpdatesInterval: p.deferredUpdatesIntervalMs,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "HYD Runners is recording your run",
        notificationBody: "Your route is being recorded. Open the app to pause or finish.",
        killServiceOnDestroy: false,
      },
    });
    return { background: true };
  }
  watcher?.remove();
  watcher = await Location.watchPositionAsync(
    { accuracy: ACCURACY[p.accuracy], timeInterval: p.timeIntervalMs, distanceInterval: p.distanceIntervalM },
    (l) => sink?.([toFix(l)]),
    (reason) => reportError(new Error(reason), "location-watch"),
  );
  return { background: false };
}

export async function stopUpdates() {
  watcher?.remove();
  watcher = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (e) {
    reportError(e, "location-stop");
  }
}
