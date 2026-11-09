import { Platform, Text } from "react-native";
import { Button, Card, Screen, styles } from "./kit";

/** Shown before the OS location prompt, the first time the runner taps Start. */
export function LocationExplainScreen({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <Screen title="Location for your run" onBack={onCancel}>
      <Text style={styles.p}>
        HYD Runners uses your phone&apos;s GPS to measure distance, pace and your route while you record a run.
      </Text>
      <Card>
        <Text style={styles.muted}>• Location is only used while a run is being recorded.</Text>
        <Text style={styles.muted}>• Your route is private by default; shared routes hide the start and end.</Text>
        <Text style={styles.muted}>• You can turn this off at any time in Settings.</Text>
      </Card>
      <Button label="Continue" onPress={onContinue} />
      <Button label="Not now" kind="secondary" onPress={onCancel} />
    </Screen>
  );
}

/** Asked separately, after foreground access, so the runner can decline just this. */
export function BackgroundExplainScreen({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  const how =
    Platform.OS === "android"
      ? "On the next screen choose “Allow all the time”. While recording, a notification shows that HYD Runners is using location."
      : "On the next prompt choose “Change to Always Allow”. While recording, iOS shows a blue location indicator.";
  return (
    <Screen title="Keep recording with the screen off">
      <Text style={styles.p}>
        To keep recording when your screen locks or you switch apps, HYD Runners needs location access in the
        background. It is only used during a run you started.
      </Text>
      <Card>
        <Text style={styles.muted}>{how}</Text>
        <Text style={styles.muted}>Without it, recording stops while the app is not on screen.</Text>
      </Card>
      <Button label="Allow background location" onPress={onAllow} />
      <Button label="Only while the app is open" kind="secondary" onPress={onSkip} />
    </Screen>
  );
}
