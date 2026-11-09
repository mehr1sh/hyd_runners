"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import type { TrainingPaces } from "../logic/pace";
import { generateWorkout, KIND_LABEL, WORKOUT_KINDS, type WorkoutKind } from "../logic/workouts";
import { WorkoutSteps } from "./workout-steps";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function WorkoutGenerator({
  paces,
  defaultLevel,
}: {
  paces: TrainingPaces | null;
  defaultLevel: "new_to_running" | "returning" | "regular";
}) {
  const [kind, setKind] = useState<WorkoutKind>("tempo");
  const [level, setLevel] = useState(defaultLevel);
  const [minutes, setMinutes] = useState(45);
  const w = generateWorkout(kind, { level, minutes, paces });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="wg-kind">Session</Label>
          <select
            id="wg-kind"
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as WorkoutKind)}
          >
            {WORKOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="wg-level">Level</Label>
          <select
            id="wg-level"
            className={selectClass}
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            <option value="new_to_running">New to running</option>
            <option value="returning">Returning or occasional</option>
            <option value="regular">Running regularly</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="wg-min">Time available (minutes)</Label>
          <select
            id="wg-min"
            className={selectClass}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {[20, 30, 45, 60, 75, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <section className="space-y-2 rounded-xl border bg-card p-4" aria-live="polite" aria-label={w.title}>
        <h2 className="font-semibold">{w.title}</h2>
        <WorkoutSteps workout={w} />
      </section>
    </div>
  );
}
