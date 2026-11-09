import { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { kmSplits, tooShortReason } from "../recording/finish";
import { formatDuration, formatKm, formatPace } from "../recording/geo";
import { metrics } from "../recording/recorder";
import * as session from "../native/session";
import { reportError } from "../lib/report-error";
import { Button, Card, Screen, styles } from "./kit";
import { useSession } from "./hooks";

/** Review a finished run, then save it to the upload queue or discard it. */
export function SummaryScreen({ onDone }: { onDone: () => void }) {
  const r = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!r || r.state.status !== "finished") return null;
  const end = r.state.finishedAt ?? Date.now();
  const m = metrics(r.state, end);
  const short = tooShortReason(r.state, end);
  const splits = kmSplits(r.state);

  async function save() {
    setBusy(true);
    try {
      await session.save(name || null);
      onDone();
    } catch (e) {
      reportError(e, "save-run");
      Alert.alert("Could not save", "The run is still on this phone. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    Alert.alert("Discard this run?", "It will be deleted from this phone and not uploaded.", [
      { text: "Keep", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void session.discard().then(onDone) },
    ]);
  }

  return (
    <Screen title="Run summary">
      <Card>
        <Text style={{ fontSize: 44, fontWeight: "700" }}>{formatKm(m.distanceM)} km</Text>
        <View style={styles.row}>
          <Text style={styles.p}>Moving {formatDuration(m.movingS)}</Text>
          <Text style={styles.p}>Elapsed {formatDuration(m.elapsedS)}</Text>
        </View>
        <Text style={styles.p}>Average pace {formatPace(m.averagePace)} /km</Text>
      </Card>
      {splits.length > 0 ? (
        <Card>
          <Text style={styles.h2}>Splits</Text>
          {splits.map((s) => (
            <View key={s.km} style={styles.row}>
              <Text style={styles.p}>Km {s.km}</Text>
              <Text style={[styles.p, { fontVariant: ["tabular-nums"] }]}>{formatPace(s.seconds)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {short ? (
        <Card>
          <Text style={styles.p}>{short}</Text>
          <Text style={styles.muted}>HYD Runners would not accept this run, so it can only be discarded.</Text>
        </Card>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Name (optional), e.g. Necklace Road loop"
            value={name}
            maxLength={120}
            onChangeText={setName}
            accessibilityLabel="Run name"
          />
          <Button label={busy ? "Saving…" : "Save and sync"} onPress={save} disabled={busy} />
          <Text style={styles.muted}>
            Saved runs upload when you are online. They stay on this phone until HYD Runners confirms them.
          </Text>
        </>
      )}
      <Button label="Discard" kind="secondary" onPress={discard} />
    </Screen>
  );
}
