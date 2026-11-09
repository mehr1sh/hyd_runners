import { useKeepAwake } from "expo-keep-awake";
import { Alert, Text, View } from "react-native";
import { signalQuality, type SignalQuality } from "../recording/filter";
import { formatDuration, formatKm, formatPace } from "../recording/geo";
import { metrics } from "../recording/recorder";
import { stepRemaining, type PlannedWorkout } from "../recording/workout";
import * as session from "../native/session";
import { Button, Card, Screen, colors, styles } from "./kit";
import { useNow, useSession } from "./hooks";

const SIGNAL: Record<SignalQuality, { label: string; color: string; bars: number }> = {
  none: { label: "No GPS signal", color: colors.poor, bars: 0 },
  poor: { label: "Weak GPS", color: colors.poor, bars: 1 },
  fair: { label: "Fair GPS", color: colors.fair, bars: 2 },
  good: { label: "Good GPS", color: colors.good, bars: 3 },
};

export function SignalIndicator({ quality }: { quality: SignalQuality }) {
  const s = SIGNAL[quality];
  return (
    <View accessible accessibilityLabel={s.label} style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
      {[1, 2, 3].map((b) => (
        <View
          key={b}
          style={{
            width: 6,
            height: 6 + b * 5,
            borderRadius: 2,
            backgroundColor: b <= s.bars ? s.color : colors.border,
          }}
        />
      ))}
      <Text style={[styles.muted, { marginLeft: 6 }]}>{s.label}</Text>
    </View>
  );
}

function Metric({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: "45%" }}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={{ fontSize: big ? 56 : 32, fontWeight: "700", color: colors.navy, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

export function RecordingScreen({ onFinished }: { onFinished: () => void }) {
  useKeepAwake(); // screen stays on while this screen is visible; background recording continues if it locks
  const r = useSession();
  const now = useNow(1000);
  if (!r) return null;
  const m = metrics(r.state, now);
  const paused = r.state.status === "paused";
  const plan = session.planFor(r.meta.workoutId);
  const step = plan ? stepDisplay(plan, m.distanceM, m.movingS) : null;

  function confirmFinish() {
    Alert.alert("Finish run?", "You can review it before saving.", [
      { text: "Keep going", style: "cancel" },
      {
        text: "Finish",
        onPress: () => void session.finish().then(onFinished),
      },
    ]);
  }

  return (
    <Screen title={paused ? "Paused" : "Recording"} scroll={false}>
      <View style={styles.row}>
        <SignalIndicator quality={signalQuality(r.state.lastFix, now)} />
        {!session.isBackgroundRecording() ? (
          <Text style={[styles.muted, { color: colors.fair }]}>Keep the app open</Text>
        ) : null}
      </View>
      <Metric label="Distance (km)" value={formatKm(m.distanceM)} big />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Metric label="Moving time" value={formatDuration(m.movingS)} />
        <Metric label="Elapsed" value={formatDuration(m.elapsedS)} />
        <Metric label="Current pace /km" value={formatPace(m.currentPace)} />
        <Metric label="Average pace /km" value={formatPace(m.averagePace)} />
      </View>
      {step ? (
        <Card>
          <Text style={styles.h2}>{step.label}</Text>
          <Text style={styles.muted}>{step.detail}</Text>
        </Card>
      ) : null}
      <View style={{ flex: 1 }} />
      <View style={{ gap: 12, paddingBottom: 16 }}>
        {paused ? (
          <Button label="Resume" onPress={() => void session.resume()} />
        ) : (
          <Button label="Pause" kind="secondary" onPress={() => void session.pause()} />
        )}
        <Button label="Finish" kind="danger" onPress={confirmFinish} />
      </View>
    </Screen>
  );
}

function stepDisplay(plan: PlannedWorkout, d: number, t: number) {
  const progress = session.workoutState();
  if (!progress) return null;
  const s = plan.steps[progress.index];
  if (!s) return { label: "Workout complete", detail: "Keep going or finish when ready." };
  const rem = stepRemaining(plan, progress, d, t);
  const left =
    rem?.meters !== undefined
      ? `${Math.round(rem.meters)} m left`
      : rem?.seconds !== undefined
        ? `${formatDuration(rem.seconds)} left`
        : "";
  const target = s.pace ? `Target ${formatPace(s.pace.min)}–${formatPace(s.pace.max)} /km` : "";
  return {
    label: `${s.label} (${progress.index + 1}/${plan.steps.length})`,
    detail: [left, target].filter(Boolean).join(" · "),
  };
}
