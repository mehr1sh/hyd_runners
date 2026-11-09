/**
 * Runtime configuration. EXPO_PUBLIC_* variables are inlined into the bundle
 * at build time (per EAS environment: development / preview / production), so
 * only public values belong here — never a secret or service-role key.
 */
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { appVariant?: string };

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  variant: (extra.appVariant ?? "development") as "development" | "preview" | "production",
};

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (!config.supabasePublishableKey) missing.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!config.apiBaseUrl) missing.push("EXPO_PUBLIC_API_BASE_URL");
  return missing;
}
