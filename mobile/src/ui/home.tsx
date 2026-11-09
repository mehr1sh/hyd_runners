import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { formatDuration, formatKm } from "../recording/geo";
import { metrics } from "../recording/recorder";
import { PRESET_WORKOUTS } from "../recording/workout";
import type { RecordingMeta } from "../recording/journal";
import type { QueuedRun } from "../sync/queue";
import * as session from "../native/session";
import { kick, syncQueue } from "../native/sync";
import { Button, Card, Choice, Screen, colors, styles } from "./kit";
import { useQueue, useSession } from "./hooks";

const TYPES: { value: RecordingMeta["activityType"]; label: string }[] = [
  { value: "run", label: "Run" },
  { value: "walk_run", label: "Walk/run" },
  { value: "walk", label: "Walk" },
  { value: "hike", label: "Hike" },
];

export function HomeScreen({
  onStart,
  onOpenRecording,
  onOpenSummary,
  onSettings,
}: {
  onStart: (type: RecordingMeta["activityType"], workoutId: string | null) => void;
  onOpenRecording: () => void;
  onOpenSummary: () => void;
  onSettings: () => void;
}) {
  const r = useSession();
  const runs = useQueue();
  const [type, setType] = useState<RecordingMeta["activityType"]>("run");
  const [workout, setWorkout] = useState<string>("none");
  const interrupted = r && (r.state.status === "recording" || r.state.status === "paused");

  return (
    <Screen title="HYD Runners">
      {interrupted ? (
        <Card style={{ borderColor: colors.orange }}>
          <Text style={styles.h2}>Resume or save the interrupted run</Text>
          <Text style={styles.muted}>
            A run started {new Date(r.state.startedAt ?? 0).toLocaleString()} was interrupted at{" "}
            {formatKm(r.state.distanceM)} km ({formatDuration(metrics(r.state, Date.now()).movingS)} moving).
          </Text>
          <Button
            label="Resume recording"
            onPress={() => {
              void session.continueRecovered();
              onOpenRecording();
            }}
          />
          <Button
            label="Finish and review"
            kind="secondary"
            onPress={() => void session.finish().then(onOpenSummary)}
          />
        </Card>
      ) : r?.state.status === "finished" ? (
        <Card style={{ borderColor: colors.orange }}>
          <Text style={styles.h2}>You have an unsaved run</Text>
          <Button label="Review and save" onPress={onOpenSummary} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.h2}>Activity</Text>
          <Choice options={TYPES} value={type} onChange={setType} />
          <Text style={styles.h2}>Workout</Text>
          <Choice
            options={[
              { value: "none", label: "Free run" },
              ...PRESET_WORKOUTS.map((w) => ({ value: w.id, label: w.name })),
            ]}
            value={workout}
            onChange={setWorkout}
          />
          <Button label="Start" onPress={() => onStart(type, workout === "none" ? null : workout)} />
        </Card>
      )}

      <View style={styles.row}>
        <Text style={styles.h2}>Your runs</Text>
        <Button label="Settings" kind="secondary" onPress={onSettings} style={{ paddingVertical: 6 }} />
      </View>
      {runs.length === 0 ? <Text style={styles.muted}>Runs you record appear here with their sync status.</Text> : null}
      {runs.map((run) => (
        <RunRow key={run.clientRef} run={run} />
      ))}
    </Screen>
  );
}

const STATUS: Record<QueuedRun["status"], string> = {
  queued: "Waiting to upload",
  uploading: "Uploading…",
  synced: "Synced",
  failed: "Upload failed",
};

function RunRow({ run }: { run: QueuedRun }) {
  const q = syncQueue();
  const label = run.status === "synced" && run.duplicate ? "Already on HYD Runners" : STATUS[run.status];
  const color = run.status === "synced" ? colors.good : run.status === "failed" ? colors.poor : colors.muted;
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.p}>
          {run.name ?? new Date(run.summary.startedAt).toLocaleDateString()} · {formatKm(run.summary.distanceM)} km
        </Text>
        <Text style={[styles.muted, { color }]}>{label}</Text>
      </View>
      {run.status === "failed" && run.lastError ? (
        <Text style={styles.muted}>
          {run.lastError}
          {run.rejected ? "" : ` Next try ${new Date(run.nextAttemptAt).toLocaleTimeString()}.`}
        </Text>
      ) : null}
      {run.status === "failed" || run.status === "queued" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label="Retry now"
            kind="secondary"
            onPress={() => void q.retryNow(run.clientRef).then(kick)}
            style={{ flex: 1, paddingVertical: 8 }}
          />
          {run.status === "failed" ? (
            <Button
              label="Discard"
              kind="secondary"
              style={{ flex: 1, paddingVertical: 8 }}
              onPress={() =>
                Alert.alert("Discard this run?", "It has not been uploaded and will be deleted from this phone.", [
                  { text: "Keep", style: "cancel" },
                  { text: "Discard", style: "destructive", onPress: () => void q.discard(run.clientRef) },
                ])
              }
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
