"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSeriesAction, scheduleSeriesAction, toggleSeriesAction, type SeriesFormState } from "../actions";
import { WEEKDAY_LABEL } from "../logic";

const idle: SeriesFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: SeriesFormState }) {
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

export function SeriesForm({
  clubId,
  locations,
}: {
  clubId: string | null;
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createSeriesAction, idle);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
      {clubId && <input type="hidden" name="clubId" value={clubId} />}
      <label className="grid gap-1 text-sm sm:col-span-2">
        Run name
        <Input name="title" required maxLength={120} placeholder="Saturday dawn loop" />
      </label>
      <div className="grid gap-1 text-sm">
        <label htmlFor={`series-weekday-${clubId ?? "city"}`}>Every</label>
        <select id={`series-weekday-${clubId ?? "city"}`} name="weekday" defaultValue="6" className={selectClass}>
          {WEEKDAY_LABEL.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <label className="grid gap-1 text-sm">
        Start time (Hyderabad)
        <Input name="startTime" type="time" required defaultValue="06:00" />
      </label>
      <label className="grid gap-1 text-sm">
        Duration (minutes)
        <Input name="durationMinutes" type="number" min={15} max={360} defaultValue={60} />
      </label>
      <label className="grid gap-1 text-sm">
        Capacity (optional)
        <Input name="capacity" type="number" min={1} />
      </label>
      <div className="grid gap-1 text-sm">
        <label htmlFor={`series-place-${clubId ?? "city"}`}>Place</label>
        <select id={`series-place-${clubId ?? "city"}`} name="locationId" defaultValue="" className={selectClass}>
          <option value="">No fixed place</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <label className="grid gap-1 text-sm">
        Meeting point (optional)
        <Input name="meetingPoint" maxLength={200} placeholder="By the main gate" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="beginnerFriendly" /> Beginner friendly
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="noDrop" defaultChecked /> No-drop (the group waits for everyone)
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        How the group regroups
        <Input
          name="regroupPolicy"
          required
          maxLength={300}
          defaultValue="We regroup at every turn and at each kilometre marker. Nobody runs alone."
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Description (optional)
        <Textarea name="description" maxLength={2000} />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Each run gets pace groups for 5:00–5:30, 5:30–6:00, 6:00–6:30 and 6:30–7:30 min/km plus run-walk. The next four
        weeks are scheduled straight away.
      </p>
      <Button type="submit" disabled={pending} className="sm:col-span-2 sm:justify-self-start">
        {pending ? "Creating…" : "Create group run"}
      </Button>
      <div className="sm:col-span-2">
        <Note state={state} />
      </div>
    </form>
  );
}

export function SeriesControls({ seriesId, active }: { seriesId: string; active: boolean }) {
  const [scheduleState, schedule, scheduling] = useActionState(scheduleSeriesAction, idle);
  const [toggleState, toggle, toggling] = useActionState(toggleSeriesAction, idle);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {active && (
        <form action={schedule} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="seriesId" value={seriesId} />
          <label className="grid gap-1 text-sm">
            Schedule ahead (weeks)
            <Input name="weeks" type="number" min={1} max={8} defaultValue={4} className="h-9 w-24" />
          </label>
          <Button type="submit" disabled={scheduling}>
            {scheduling ? "Scheduling…" : "Schedule runs"}
          </Button>
        </form>
      )}
      <Note state={scheduleState} />
      <form action={toggle}>
        <input type="hidden" name="seriesId" value={seriesId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        <Button type="submit" variant="outline" size="sm" disabled={toggling}>
          {active ? "Pause series" : "Resume series"}
        </Button>
      </form>
      <Note state={toggleState} />
    </div>
  );
}
