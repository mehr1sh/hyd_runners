"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDuration } from "@/features/events/logic";
import {
  addRace,
  addSponsor,
  checkInByToken,
  importResults,
  recordResult,
  saveRaceDetails,
  type PassportState,
} from "../actions";
import type { RaceEntry } from "../queries";

const idle: PassportState = { status: "idle" };
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Note({ state }: { state: PassportState }) {
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

export function AddRaceForm({ event }: { event?: { id: string; title: string; date: string } }) {
  const [state, action, pending] = useActionState(addRace, idle);
  return (
    <form action={action} className="space-y-3">
      {event && <input type="hidden" name="eventId" value={event.id} />}
      <div className="space-y-1">
        <Label htmlFor={`race-name-${event?.id ?? "new"}`}>Race</Label>
        <Input
          id={`race-name-${event?.id ?? "new"}`}
          name="name"
          required
          maxLength={120}
          defaultValue={event?.title ?? ""}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`race-date-${event?.id ?? "new"}`}>Date</Label>
          <Input
            id={`race-date-${event?.id ?? "new"}`}
            name="raceDate"
            type="date"
            required
            defaultValue={event?.date ?? ""}
            max="2100-01-01"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`race-dist-${event?.id ?? "new"}`}>Distance</Label>
          <select id={`race-dist-${event?.id ?? "new"}`} name="distance" className={selectClass} defaultValue="10k">
            <option value="5k">5K</option>
            <option value="10k">10K</option>
            <option value="half">Half marathon</option>
            <option value="marathon">Marathon</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`race-km-${event?.id ?? "new"}`}>Other distance (km)</Label>
          <Input id={`race-km-${event?.id ?? "new"}`} name="otherKm" type="number" step="0.1" min={1} max={250} />
        </div>
      </div>
      {!event && (
        <div className="space-y-1">
          <Label htmlFor="race-city">City (optional)</Label>
          <Input id="race-city" name="city" maxLength={80} placeholder="Hyderabad" />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Add to passport
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function RaceDetailsForm({ entry }: { entry: RaceEntry }) {
  const [state, action, pending] = useActionState(saveRaceDetails, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={entry.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rd-status">Status</Label>
          <select id="rd-status" name="status" className={selectClass} defaultValue={entry.status}>
            <option value="planned">Planning to run</option>
            <option value="registered">Registered</option>
            <option value="completed">Finished</option>
            <option value="dnf">Did not finish</option>
            <option value="dns">Did not start</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rd-target">Target time (optional)</Label>
          <Input
            id="rd-target"
            name="target"
            placeholder="h:mm:ss"
            defaultValue={entry.targetSeconds ? formatDuration(entry.targetSeconds) : ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rd-bib">Bib number</Label>
          <Input id="rd-bib" name="bib" maxLength={20} defaultValue={entry.bib ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rd-wave">Wave or corral</Label>
          <Input id="rd-wave" name="wave" maxLength={40} defaultValue={entry.wave ?? ""} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rd-travel">Travel and logistics notes</Label>
        <Textarea id="rd-travel" name="travelNotes" maxLength={1000} rows={2} defaultValue={entry.travelNotes ?? ""} />
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="text-sm font-medium">
          Emergency contact (private to you; shown on your race-day screen)
        </legend>
        <Input
          name="emergencyName"
          placeholder="Name"
          maxLength={80}
          aria-label="Emergency contact name"
          defaultValue={entry.emergencyName ?? ""}
        />
        <Input
          name="emergencyPhone"
          placeholder="+91 …"
          maxLength={20}
          aria-label="Emergency contact phone"
          defaultValue={entry.emergencyPhone ?? ""}
        />
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="findPartners" defaultChecked={entry.findPartners} className="mt-1" />
        <span>
          Let other runners in this race with a similar target find me (shows your name, target and level only).
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function ResultForm({
  entryId,
  activities,
  reflection,
}: {
  entryId: string;
  activities: { id: string; label: string }[];
  reflection: string | null;
}) {
  const [state, action, pending] = useActionState(recordResult, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={entryId} />
      {activities.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="res-act">Use a recorded activity from race day</Label>
          <select id="res-act" name="activityId" className={selectClass} defaultValue="">
            <option value="">No, I&apos;ll type my time</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="max-w-48 space-y-1">
        <Label htmlFor="res-time">Finish time</Label>
        <Input id="res-time" name="time" placeholder="h:mm:ss" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="res-ref">How did it go? (optional, private)</Label>
        <Textarea id="res-ref" name="reflection" maxLength={2000} rows={3} defaultValue={reflection ?? ""} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save result
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function CheckInForm({ eventId, token }: { eventId: string; token: string }) {
  const [state, action, pending] = useActionState(checkInByToken, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending || state.status === "success"}>
        {state.status === "success" ? "Checked in" : "Check this runner in"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function SponsorForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(addSponsor, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="eventId" value={eventId} />
      <Input name="name" placeholder="Sponsor name" aria-label="Sponsor name" required maxLength={80} />
      <Input name="url" placeholder="https://" aria-label="Sponsor link" maxLength={300} />
      <select name="tier" className={selectClass} aria-label="Sponsor tier" defaultValue="supporter">
        <option value="title">Title sponsor</option>
        <option value="partner">Partner</option>
        <option value="supporter">Supporter</option>
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        Add sponsor
      </Button>
      <div className="sm:col-span-4">
        <Note state={state} />
      </div>
    </form>
  );
}

export function ResultsImportForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(importResults, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <Label htmlFor="res-csv">Paste results: user_id, outcome (finished, dnf or dns), time</Label>
      <Textarea id="res-csv" name="csv" rows={4} placeholder="0b5f…-…, finished, 52:31" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Import results
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
