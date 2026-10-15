"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorkoutType } from "@/lib/contracts";
import { WORKOUT_TYPE_LABEL } from "@/features/dashboard/format";
import { logManualWorkoutAction, type ActionState } from "../actions";

const TYPES = (Object.keys(WORKOUT_TYPE_LABEL) as WorkoutType[]).filter((t) => t !== "rest");

function nowLocalInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function browserOffset() {
  const m = -new Date().getTimezoneOffset();
  const sign = m >= 0 ? "+" : "-";
  const a = Math.abs(m);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export function ManualWorkoutForm({
  link,
  defaults,
  locations,
}: {
  link?:
    | { linkKind: "programme"; enrollmentId: string; sessionId: string }
    | { linkKind: "planned"; plannedWorkoutId: string };
  defaults?: { title: string; workoutType: WorkoutType; minutes: number };
  locations: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(logManualWorkoutAction, { status: "idle" } as ActionState);
  // One key per form instance: a double-click or retry cannot create two workouts.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [startedAt] = useState(nowLocalInput);
  const [offset] = useState(browserOffset);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="tzOffset" value={offset} />
      {link && Object.entries(link).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="title">What did you do?</FieldLabel>
          <Input
            id="title"
            name="title"
            required
            maxLength={120}
            defaultValue={defaults?.title ?? ""}
            readOnly={!!link}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="workoutType">Activity type</FieldLabel>
          <select
            id="workoutType"
            name="workoutType"
            defaultValue={defaults?.workoutType ?? "run"}
            disabled={!!link}
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {WORKOUT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {link && <input type="hidden" name="workoutType" value={defaults?.workoutType ?? "run"} />}
        </Field>
        <Field>
          <FieldLabel htmlFor="startedAtLocal">Started at</FieldLabel>
          <Input id="startedAtLocal" name="startedAtLocal" type="datetime-local" required defaultValue={startedAt} />
          <FieldDescription>You can log workouts from the last 7 days.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="durationMinutes">Active time (minutes)</FieldLabel>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={360}
            required
            defaultValue={defaults?.minutes ?? 30}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="distanceKm">Distance in km (optional)</FieldLabel>
          <Input id="distanceKm" name="distanceKm" type="number" inputMode="decimal" min={0} max={100} step="0.01" />
        </Field>
        <Field>
          <FieldLabel htmlFor="perceivedEffort">How hard did it feel? (1–10, optional)</FieldLabel>
          <Input id="perceivedEffort" name="perceivedEffort" type="number" inputMode="numeric" min={1} max={10} />
        </Field>
        {locations.length > 0 && (
          <Field>
            <FieldLabel htmlFor="locationId">Where (public place, optional)</FieldLabel>
            <select
              id="locationId"
              name="locationId"
              defaultValue=""
              className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">Not specified</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
          <Textarea id="notes" name="notes" rows={3} maxLength={1000} />
        </Field>
      </FieldGroup>
      {state.status === "error" && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : "Save workout"}
      </Button>
    </form>
  );
}
