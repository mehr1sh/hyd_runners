"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EXERCISE_BY_KEY,
  MUSCLE_LABEL,
  MUSCLES,
  STRENGTH_SESSIONS,
  type StrengthSessionKey,
} from "@/features/training/logic/strength-templates";
import { logStrength, proposeReturnToRun, saveEntry, type RecoveryState } from "../actions";
import type { JournalEntry } from "../server/queries";

const idle: RecoveryState = { status: "idle" };

function Note({ state }: { state: RecoveryState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`text-sm ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {state.message}
    </p>
  );
}

function Scale({
  name,
  label,
  low,
  high,
  value,
}: {
  name: string;
  label: string;
  low: string;
  high: string;
  value: number | null;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>{low}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="flex cursor-pointer flex-col items-center rounded-md border px-2 py-1 has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy-soft"
          >
            <input
              type="radio"
              name={name}
              value={n}
              defaultChecked={value === n}
              className="sr-only"
              aria-label={`${label} ${n} of 5`}
            />
            <span className="text-sm text-foreground">{n}</span>
          </label>
        ))}
        <span>{high}</span>
        <label className="ml-2 flex items-center gap-1">
          <input type="radio" name={name} value="" defaultChecked={value === null} /> skip
        </label>
      </div>
    </fieldset>
  );
}

const ACTIVITY_LABEL = {
  stretching: "Stretching",
  foam_rolling: "Foam rolling",
  mobility: "Mobility",
  massage: "Massage",
  yoga: "Yoga",
  walk: "Easy walk",
  rest: "Full rest",
  other: "Other",
} as const;

export function EntryForm({
  date,
  maxDate,
  minDate,
  entry,
}: {
  date: string;
  maxDate: string;
  minDate: string;
  entry: JournalEntry | null;
}) {
  const [state, action, pending] = useActionState(saveEntry, idle);
  return (
    <form action={action} className="space-y-4" key={`${date}-${entry?.id ?? "new"}`}>
      <div className="max-w-48 space-y-1">
        <Label htmlFor="entry-date">Date</Label>
        <Input id="entry-date" name="date" type="date" defaultValue={date} min={minDate} max={maxDate} required />
      </div>
      <p className="text-xs text-muted-foreground">Every field is optional. Fill in only what you want to track.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Scale name="sleepQuality" label="Sleep quality" low="poor" high="great" value={entry?.sleepQuality ?? null} />
        <div className="space-y-1">
          <Label htmlFor="entry-sleep-hours">Hours of sleep</Label>
          <Input
            id="entry-sleep-hours"
            name="sleepHours"
            type="number"
            step="0.5"
            min={0}
            max={16}
            defaultValue={entry?.sleepHours ?? ""}
            className="max-w-28"
          />
        </div>
        <Scale name="fatigue" label="Fatigue" low="fresh" high="exhausted" value={entry?.fatigue ?? null} />
        <Scale name="soreness" label="Muscle soreness" low="none" high="very sore" value={entry?.soreness ?? null} />
        <Scale name="energy" label="Energy" low="low" high="high" value={entry?.energy ?? null} />
        <Scale name="stress" label="Stress" low="calm" high="very stressed" value={entry?.stress ?? null} />
        <div className="space-y-1">
          <Label htmlFor="entry-rpe">How hard was today&apos;s workout? (1–10, optional)</Label>
          <Input
            id="entry-rpe"
            name="workoutRpe"
            type="number"
            min={1}
            max={10}
            defaultValue={entry?.workoutRpe ?? ""}
            className="max-w-28"
          />
        </div>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Where are you sore? (optional)</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {MUSCLES.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" name="sorenessAreas" value={m} defaultChecked={entry?.sorenessAreas.includes(m)} />
              {MUSCLE_LABEL[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Recovery you did</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="recoveryActivities"
                value={k}
                defaultChecked={entry?.recoveryActivities.includes(k)}
              />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="entry-notes">Notes (optional, private)</Label>
        <Textarea id="entry-notes" name="notes" maxLength={500} rows={2} defaultValue={entry?.notes ?? ""} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="shareWithCoach" defaultChecked={entry?.shareWithCoach ?? false} className="mt-1" />
        <span>
          Share this entry with my assigned coach. Off by default; only a coach currently assigned to you can see shared
          entries.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : entry ? "Update entry" : "Save entry"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function StrengthLogForm({
  sessionKey,
  today,
  minDate,
}: {
  sessionKey: StrengthSessionKey;
  today: string;
  minDate: string;
}) {
  const [state, action, pending] = useActionState(logStrength, idle);
  const s = STRENGTH_SESSIONS[sessionKey];
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sessionKey" value={sessionKey} />
      <ul className="space-y-1 text-sm">
        {s.exercises.map((k) => {
          const e = EXERCISE_BY_KEY.get(k)!;
          return (
            <li key={k}>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="exercises" value={k} defaultChecked className="mt-1" />
                <span>
                  <span className="font-medium">{e.name}</span> · {e.dose}
                  <span className="block text-xs text-muted-foreground">{e.cue}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${sessionKey}-date`}>Date</Label>
          <Input id={`${sessionKey}-date`} name="date" type="date" defaultValue={today} max={today} min={minDate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${sessionKey}-min`}>Minutes</Label>
          <Input
            id={`${sessionKey}-min`}
            name="minutes"
            type="number"
            min={5}
            max={180}
            defaultValue={s.minutes}
            className="w-24"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${sessionKey}-sets`}>Sets each</Label>
          <Input
            id={`${sessionKey}-sets`}
            name="sets"
            type="number"
            min={1}
            max={10}
            defaultValue={2}
            className="w-20"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log session"}
        </Button>
      </div>
      <Note state={state} />
    </form>
  );
}

export function ReturnToRunForm() {
  const [state, action, pending] = useActionState(proposeReturnToRun, idle);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acknowledge" className="mt-1" />
        <span>
          I understand this is general guidance for returning after a break. If I&apos;m coming back from an injury, I
          have been cleared to run by a doctor or physiotherapist and will follow their advice first.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Preparing…" : "Propose a return-to-running plan"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
