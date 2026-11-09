import { Platform } from "react-native";
import { unsupportedHealth, type HealthProvider } from "./provider";

export type { HealthProvider, HealthWorkout } from "./provider";

/**
 * The platform's health provider. Loaded lazily so a missing native module
 * (Expo Go, simulator) degrades to "unsupported" instead of crashing.
 */
export function healthProvider(): HealthProvider {
  try {
    if (Platform.OS === "android")
      return (require("./health-connect") as typeof import("./health-connect")).healthConnect;
    if (Platform.OS === "ios") return (require("./healthkit") as typeof import("./healthkit")).healthKit;
  } catch {
    /* native module not in this build */
  }
  return unsupportedHealth;
}
