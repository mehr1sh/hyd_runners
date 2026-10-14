"use client";

import { useActionState, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { completeWorkoutAction, type ActionState } from "../actions";

function useElapsedMinutes(startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(1, Math.round((now - new Date(startedAt).getTime()) / 60_000));
}

export function CompleteWorkoutForm({
  workoutId,
  startedAt,
  suggestedMinutes,
  showDistance,
  locations,
}: {
  workoutId: string;
  startedAt: string;
  suggestedMinutes: number | null;
  showDistance: boolean;
  locations: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(completeWorkoutAction, { status: "idle" } as ActionState);
  const elapsed = useElapsedMinutes(startedAt);
  const [minutes, setMinutes] = useState<string>("");
  const shown = minutes || String(Math.min(360, elapsed > 2 ? elapsed : (suggestedMinutes ?? elapsed)));

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="workoutId" value={workoutId} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Started {elapsed} min ago.
      </p>
      <FieldGroup>
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
            value={shown}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <FieldDescription>Defaults to the time since you pressed start. Adjust it if you paused.</FieldDescription>
        </Field>
        {showDistance && (
          <Field>
            <FieldLabel htmlFor="distanceKm">Distance in km (optional)</FieldLabel>
            <Input id="distanceKm" name="distanceKm" type="number" inputMode="decimal" min={0} max={100} step="0.01" />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="perceivedEffort">
            How hard did it feel? (1 = very easy, 10 = maximal, optional)
          </FieldLabel>
          <Input id="perceivedEffort" name="perceivedEffort" type="number" inputMode="numeric" min={1} max={10} />
        </Field>
        {locations.length > 0 && (
          <Field>
            <FieldLabel htmlFor="locationId">Where (public place, optional)</FieldLabel>
            <select
              id="locationId"
              name="locationId"
              className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              defaultValue=""
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
        {pending ? "Saving…" : "Complete workout"}
      </Button>
    </form>
  );
}
