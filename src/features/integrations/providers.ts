/**
 * Activity and health data sources. The core activity model stays provider-
 * neutral: every source produces a ParsedActivity that goes through
 * normalizeActivity() and finalize_activity_import(), so metrics, best
 * efforts, privacy trimming and duplicate detection are identical.
 *
 * Status is reported honestly: a source is "available" only when it works
 * end to end in this deployment.
 */

export type ProviderStatus = "available" | "needs_configuration" | "requires_app_build" | "not_available";

export type Provider = {
  key: "file_export" | "hyd_app" | "strava" | "health_connect" | "healthkit";
  name: string;
  status: ProviderStatus;
  summary: string;
  dataUsed: string;
  revocation: string;
  requirement?: string;
  href?: string;
};

export function providers(env: { stravaConfigured: boolean }): Provider[] {
  return [
    {
      key: "file_export",
      name: "GPX and FIT files (any watch)",
      status: "available",
      summary:
        "Export a GPX or FIT file from Garmin, Coros, Suunto, Polar, Apple Watch apps and most others, then import it.",
      dataUsed: "GPS track, time, distance, elevation, heart rate and cadence if the file has them.",
      revocation: "Delete any imported activity at any time; its file is deleted with it.",
      href: "/activities/import",
    },
    {
      key: "hyd_app",
      name: "HYD Runners app",
      status: "requires_app_build",
      summary: "Record runs with GPS on your phone; they sync to your account even after being offline.",
      dataUsed: "GPS points, timer and pauses of runs you record.",
      revocation: "Delete recorded activities here; sign out of the app to stop syncing.",
      requirement:
        "The app is built and tested in code, but not yet published: it needs the owner's Apple and Google developer accounts.",
    },
    {
      key: "strava",
      name: "Strava",
      status: env.stravaConfigured ? "needs_configuration" : "not_available",
      summary: "Import your Strava activities automatically.",
      dataUsed: "Your own activities (read-only scope activity:read). Strava data would stay private to you.",
      revocation: "Disconnect would delete stored tokens and, if you choose, every activity imported from Strava.",
      requirement:
        "Needs Strava API approval for this app, a review of Strava's API agreement (data may be shown only to its owner, and AI use is restricted) and possibly a paid developer tier. Not enabled.",
    },
    {
      key: "health_connect",
      name: "Health Connect (Android)",
      status: "requires_app_build",
      summary: "Read workouts from Android's Health Connect in the HYD Runners app.",
      dataUsed: "Exercise sessions, routes and distance only, read-only.",
      revocation: "Revoke in Android settings → Health Connect at any time.",
      requirement:
        "Implemented in the app as a read-only adapter; needs a development build, a real device and Google Play's health-permission declaration.",
    },
    {
      key: "healthkit",
      name: "Apple Health (iOS)",
      status: "requires_app_build",
      summary: "Read workouts from Apple Health in the HYD Runners app.",
      dataUsed: "Workouts, workout routes and distance only, read-only.",
      revocation: "Revoke in iOS Settings → Health → Data Access at any time.",
      requirement:
        "Implemented in the app as a read-only adapter; needs an Apple Developer account with the HealthKit capability, a development build and a real device.",
    },
  ];
}
