import { useCallback, useEffect, useState } from "react";
import { AppState, Switch, Text, View } from "react-native";
import { supabase } from "../auth/supabase";
import { config } from "../config";
import { healthProvider, type HealthProvider } from "../health";
import { recentErrors } from "../lib/report-error";
import type { CuePrefs } from "../recording/cues";
import { getLocationPermissions, openOsSettings, type LocationPermissions } from "../native/location";
import * as session from "../native/session";
import { Button, Card, Choice, Screen, styles } from "./kit";

const LABEL = { granted: "Allowed", denied: "Not allowed", undetermined: "Not asked yet" } as const;

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [perms, setPerms] = useState<LocationPermissions | null>(null);
  const [cues, setCues] = useState<CuePrefs>(session.getCuePrefs());
  const [health] = useState<HealthProvider>(() => healthProvider());
  const [healthState, setHealthState] = useState<string>("Checking…");

  const refresh = useCallback(async () => {
    setPerms(await getLocationPermissions());
    const availability = await health.availability();
    if (availability !== "available") {
      setHealthState(
        availability === "not_installed"
          ? "Health Connect needs to be installed or updated"
          : "Not available in this build",
      );
    } else {
      setHealthState((await health.hasPermissions()) ? "Connected (read only)" : "Not connected");
    }
  }, [health]);

  useEffect(() => {
    void refresh();
    // Re-check after the runner returns from the OS settings.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const update = (next: CuePrefs) => {
    setCues(next);
    void session.setCuePrefs(next);
  };

  return (
    <Screen title="Settings" onBack={onBack}>
      <Card>
        <Text style={styles.h2}>Location</Text>
        <Text style={styles.p}>While using the app: {perms ? LABEL[perms.foreground] : "…"}</Text>
        <Text style={styles.p}>In the background: {perms ? LABEL[perms.background] : "…"}</Text>
        <Text style={styles.muted}>Change or revoke location access in your phone&apos;s settings.</Text>
        <Button label="Open phone settings" kind="secondary" onPress={() => void openOsSettings()} />
      </Card>

      <Card>
        <Text style={styles.h2}>Audio cues</Text>
        <View style={styles.row}>
          <Text style={styles.p}>Mute all cues</Text>
          <Switch
            value={cues.muted}
            onValueChange={(muted) => update({ ...cues, muted })}
            accessibilityLabel="Mute all cues"
          />
        </View>
        <Text style={styles.muted}>Announce splits</Text>
        <Choice
          options={[
            { value: "0", label: "Never" },
            { value: "1", label: "Every km" },
            { value: "2", label: "Every 2 km" },
            { value: "5", label: "Every 5 km" },
          ]}
          value={String(cues.splitEveryKm)}
          onChange={(v) => update({ ...cues, splitEveryKm: Number(v) as CuePrefs["splitEveryKm"] })}
        />
        <View style={styles.row}>
          <Text style={styles.p}>Pace target reminders</Text>
          <Switch
            value={cues.paceNudges}
            onValueChange={(paceNudges) => update({ ...cues, paceNudges })}
            accessibilityLabel="Pace target reminders"
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.h2}>{health.platform === "healthkit" ? "Apple Health" : "Health Connect"}</Text>
        <Text style={styles.p}>{healthState}</Text>
        <Text style={styles.muted}>
          Read only: workouts, routes and distance. HYD Runners never writes health data.
        </Text>
        {health.platform !== "none" ? (
          <View style={{ gap: 8 }}>
            <Button label="Connect" kind="secondary" onPress={() => void health.requestPermissions().then(refresh)} />
            <Button label="Revoke access" kind="secondary" onPress={() => void health.revoke().then(refresh)} />
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.h2}>Account</Text>
        <Button label="Sign out" kind="secondary" onPress={() => void supabase().auth.signOut()} />
        <Text style={styles.muted}>Runs waiting to upload stay on this phone and upload after you sign in again.</Text>
      </Card>

      <Card>
        <Text style={styles.h2}>Diagnostics</Text>
        <Text style={styles.muted}>Build: {config.variant}</Text>
        {recentErrors().length === 0 ? <Text style={styles.muted}>No recent errors.</Text> : null}
        {recentErrors()
          .slice(-10)
          .map((e) => (
            <Text key={`${e.at}-${e.context}`} style={styles.muted}>
              {new Date(e.at).toLocaleTimeString()} [{e.context}] {e.message}
            </Text>
          ))}
      </Card>
    </Screen>
  );
}
