import type { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "./src/auth/supabase";
import { missingConfig } from "./src/config";
import { reportError } from "./src/lib/report-error";
import type { RecordingMeta } from "./src/recording/journal";
import { getLocationPermissions, openOsSettings, requestBackground, requestForeground } from "./src/native/location";
import * as session from "./src/native/session";
import { kick, startSync } from "./src/native/sync";
import { getPref, setPref } from "./src/storage/db";
import { HomeScreen } from "./src/ui/home";
import { Screen, styles } from "./src/ui/kit";
import { BackgroundExplainScreen, LocationExplainScreen } from "./src/ui/permissions";
import { RecordingScreen } from "./src/ui/recording";
import { SettingsScreen } from "./src/ui/settings";
import { SignInScreen } from "./src/ui/sign-in";
import { SummaryScreen } from "./src/ui/summary";

type Route = "home" | "explain-location" | "explain-background" | "recording" | "summary" | "settings";
type Pending = { type: RecordingMeta["activityType"]; workoutId: string | null };

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [auth, setAuth] = useState<Session | null>(null);
  const [route, setRoute] = useState<Route>("home");
  const [pending, setPending] = useState<Pending | null>(null);
  const missing = missingConfig();

  useEffect(() => {
    if (missing.length) return;
    void session.ensureLoaded().then(() => {
      const r = session.current();
      if (r?.state.status === "finished") setRoute("summary");
    });
    void startSync().catch((e) => reportError(e, "sync-start"));
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        setAuth(data.session);
        setAuthReady(true);
      });
    const { data } = supabase().auth.onAuthStateChange((_event, s) => {
      setAuth(s);
      if (s) void kick(); // runs queued while signed out upload now
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function begin(p: Pending) {
    try {
      await session.start(p.type, p.workoutId);
      setRoute("recording");
    } catch (e) {
      reportError(e, "start");
      Alert.alert("Could not start", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function onStart(type: RecordingMeta["activityType"], workoutId: string | null) {
    const p = { type, workoutId };
    setPending(p);
    const perms = await getLocationPermissions();
    if (perms.foreground !== "granted") {
      if (perms.foreground === "denied" && !perms.canAskAgain) {
        Alert.alert("Location is off", "Allow location for HYD Runners in your phone settings to record runs.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => void openOsSettings() },
        ]);
        return;
      }
      setRoute("explain-location");
      return;
    }
    await afterForeground(p);
  }

  async function afterForeground(p: Pending) {
    const perms = await getLocationPermissions();
    const { asked } = await getPref("background-asked", { asked: false });
    if (perms.background !== "granted" && !asked) {
      setRoute("explain-background");
      return;
    }
    await begin(p);
  }

  let body;
  if (missing.length) {
    body = (
      <Screen title="Configuration missing">
        <Text style={styles.p}>This build is missing: {missing.join(", ")}. See docs/mobile.md.</Text>
      </Screen>
    );
  } else if (!authReady) {
    body = (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  } else if (!auth && route !== "recording" && route !== "summary") {
    // Recording and saving work signed out too; only the home screen needs an account.
    body = <SignInScreen />;
  } else if (route === "explain-location" && pending) {
    body = (
      <LocationExplainScreen
        onCancel={() => setRoute("home")}
        onContinue={async () => {
          const state = await requestForeground();
          if (state === "granted") await afterForeground(pending);
          else setRoute("home");
        }}
      />
    );
  } else if (route === "explain-background" && pending) {
    const done = async (ask: boolean) => {
      await setPref("background-asked", { asked: true });
      if (ask) await requestBackground();
      await begin(pending);
    };
    body = <BackgroundExplainScreen onAllow={() => void done(true)} onSkip={() => void done(false)} />;
  } else if (route === "recording") {
    body = <RecordingScreen onFinished={() => setRoute("summary")} />;
  } else if (route === "summary") {
    body = <SummaryScreen onDone={() => setRoute("home")} />;
  } else if (route === "settings") {
    body = <SettingsScreen onBack={() => setRoute("home")} />;
  } else {
    body = (
      <HomeScreen
        onStart={(t, w) => void onStart(t, w)}
        onOpenRecording={() => setRoute("recording")}
        onOpenSummary={() => setRoute("summary")}
        onSettings={() => setRoute("settings")}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {body}
    </SafeAreaProvider>
  );
}
