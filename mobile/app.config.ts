import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Three app variants installable side by side, selected by APP_VARIANT (set
 * per EAS build profile in eas.json): development, preview, production.
 * Public runtime values (EXPO_PUBLIC_SUPABASE_URL,
 * EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_API_BASE_URL) come from
 * the matching EAS environment or a local .env file and are never committed.
 */
const variant = (process.env.APP_VARIANT ?? "development") as "development" | "preview" | "production";
const suffix = variant === "production" ? "" : `.${variant}`;
const name = variant === "production" ? "HYD Runners" : `HYD Runners (${variant})`;
const id = `in.hydrunners.app${suffix}`;

const LOCATION_WHY =
  "HYD Runners uses your location to measure distance, pace and route while you record a run. Location is only used during a run you started.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: "hyd-runners",
  scheme: variant === "production" ? "hydrunners" : `hydrunners-${variant}`,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: id,
    supportsTablet: false,
    infoPlist: {
      // Set by the expo-location plugin too; kept explicit for review.
      UIBackgroundModes: ["location"],
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: { "com.apple.developer.healthkit": true },
  },
  android: {
    package: id,
    permissions: [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      // Health Connect: read only, exercise sessions, routes and distance.
      "android.permission.health.READ_EXERCISE",
      "android.permission.health.READ_EXERCISE_ROUTES",
      "android.permission.health.READ_DISTANCE",
    ],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.SYSTEM_ALERT_WINDOW"],
  },
  plugins: [
    [
      "expo-location",
      {
        locationWhenInUsePermission: LOCATION_WHY,
        locationAlwaysAndWhenInUsePermission: `${LOCATION_WHY} Background access keeps recording when the screen is locked.`,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    "expo-sqlite",
    "expo-secure-store",
    "react-native-health-connect",
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription:
          "HYD Runners can read your workouts, routes and distance to show runs recorded by other apps.",
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
  ],
  extra: {
    appVariant: variant,
    // eas: { projectId: "<set by `eas init` — owner action>" },
  },
});
