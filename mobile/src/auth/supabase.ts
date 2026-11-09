/**
 * Supabase client for sign-in only. The session is persisted in the device
 * keychain/keystore (expo-secure-store), chunked because sessions can exceed
 * the secure store's comfortable value size. The app never writes tables
 * directly; runs go through the web API so server-side rules apply.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { config } from "../config";
import { chunkedStorage } from "./chunked-storage";

const secureKv = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) =>
    SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      config.supabaseUrl || "http://invalid.localhost",
      config.supabasePublishableKey || "missing",
      {
        auth: {
          storage: chunkedStorage(secureKv),
          storageKey: "hydr-auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
    // Refresh tokens only while the app is in the foreground (Supabase's RN guidance).
    AppState.addEventListener("change", (state) => {
      if (state === "active") client?.auth.startAutoRefresh();
      else client?.auth.stopAutoRefresh();
    });
  }
  return client;
}

/** A fresh access token for API calls, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  const session = data.session;
  if (!session) return null;
  // Refresh a token that expires within a minute (background uploads).
  if (session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
    const { data: refreshed } = await supabase().auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }
  return session.access_token;
}
