"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPace } from "@/features/events/logic";
import {
  addSquadRun,
  createSquad,
  postSquadMessage,
  reportSquadMessage,
  saveMatchingProfile,
  squadAction,
  type SquadState,
} from "../actions";
import { AREAS, GOALS } from "../logic";
import type { MatchingProfile } from "../queries";

const idle: SquadState = { status: "idle" };
const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = {
  early_morning: "Early morning",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
} as const;

function Note({ state }: { state: SquadState }) {
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

function Checks({
  name,
  legend,
  options,
  selected,
}: {
  name: string;
  legend: string;
  options: Record<string, string>;
  selected: string[];
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {Object.entries(options).map(([k, v]) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" name={name} value={k} defaultChecked={selected.includes(k)} />
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function MatchingForm({ profile }: { profile: MatchingProfile | null }) {
  const [state, action, pending] = useActionState(saveMatchingProfile, idle);
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="optedIn" defaultChecked={profile?.optedIn ?? false} className="mt-1" />
        <span>
          Show me in runner matching
          <span className="block font-normal text-muted-foreground">
            Off by default. Others see your name, intro, pace range and the areas you share with them, never your
            location.
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="m-pmin">Easy pace from (min/km)</Label>
          <Input
            id="m-pmin"
            name="paceMin"
            placeholder="5:45"
            defaultValue={profile?.paceMin ? formatPace(profile.paceMin) : ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-pmax">to (min/km)</Label>
          <Input
            id="m-pmax"
            name="paceMax"
            placeholder="6:30"
            defaultValue={profile?.paceMax ? formatPace(profile.paceMax) : ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-km">Typical run (km)</Label>
          <Input
            id="m-km"
            name="typicalKm"
            type="number"
            step="0.5"
            min={1}
            max={60}
            defaultValue={profile?.typicalKm ?? ""}
          />
        </div>
      </div>
      <Checks
        name="areas"
        legend="Where you like to run (up to five)"
        options={AREAS}
        selected={profile?.areas ?? []}
      />
      <Checks
        name="days"
        legend="Days"
        options={Object.fromEntries(DAYS.map((d, i) => [String(i + 1), d]))}
        selected={(profile?.days ?? []).map(String)}
      />
      <Checks name="times" legend="Times" options={TIMES} selected={profile?.times ?? []} />
      <Checks name="goals" legend="Goals" options={GOALS} selected={profile?.goals ?? []} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="m-exp">Experience</Label>
          <select
            id="m-exp"
            name="experience"
            className={`${selectClass} w-full`}
            defaultValue={profile?.experience ?? ""}
          >
            <option value="">Prefer not to say</option>
            <option value="new_to_running">New to running</option>
            <option value="returning">Returning or occasional</option>
            <option value="regular">Running regularly</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-size">Looking for</Label>
          <select
            id="m-size"
            name="groupSize"
            className={`${selectClass} w-full`}
            defaultValue={profile?.groupSize ?? "any"}
          >
            <option value="partner">A running partner</option>
            <option value="small_group">A small group</option>
            <option value="any">Either</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-intro">Short intro (optional)</Label>
        <Input id="m-intro" name="intro" maxLength={160} defaultValue={profile?.intro ?? ""} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function SquadButton({
  squadId,
  action,
  label,
  userId,
  variant = "outline",
  confirm,
}: {
  squadId: string;
  action: string;
  label: string;
  userId?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  confirm?: string;
}) {
  const [state, run, pending] = useActionState(squadAction, idle);
  return (
    <form
      action={run}
      className="inline-flex flex-col gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="squadId" value={squadId} />
      <input type="hidden" name="action" value={action} />
      {userId && <input type="hidden" name="userId" value={userId} />}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function InviteToSquad({ userId, squads }: { userId: string; squads: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState(squadAction, idle);
  if (squads.length === 0) return null;
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="action" value="invite" />
      <input type="hidden" name="userId" value={userId} />
      <select name="squadId" className={selectClass} aria-label="Squad to invite to">
        {squads.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Invite to squad
      </Button>
      <Note state={state} />
    </form>
  );
}

export function CreateSquadForm() {
  const [state, action, pending] = useActionState(createSquad, idle);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sq-name">Squad name</Label>
          <Input id="sq-name" name="name" required maxLength={60} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sq-km">Weekly distance target, km (optional)</Label>
          <Input id="sq-km" name="weeklyKm" type="number" min={1} max={1000} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sq-policy">Who can join</Label>
          <select id="sq-policy" name="joinPolicy" className={`${selectClass} w-full`} defaultValue="invite_only">
            <option value="invite_only">Invite only</option>
            <option value="request">Anyone can ask to join</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sq-max">Size limit</Label>
          <select id="sq-max" name="maxMembers" className={`${selectClass} w-full`} defaultValue="6">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} runners
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sq-desc">What the squad is about (optional)</Label>
        <Textarea id="sq-desc" name="description" maxLength={500} rows={2} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Create squad
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function ChatForm({ squadId }: { squadId: string }) {
  const [state, action, pending] = useActionState(postSquadMessage, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="squadId" value={squadId} />
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor="sq-msg" className="sr-only">
          Message
        </Label>
        <Input id="sq-msg" name="body" required maxLength={1000} placeholder="Message the squad" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Send
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ReportMessage({ messageId }: { messageId: string }) {
  const [state, action, pending] = useActionState(reportSquadMessage, idle);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Report</summary>
      <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
        <input type="hidden" name="messageId" value={messageId} />
        <select name="reason" className={selectClass} aria-label="Reason">
          <option value="harassment">Harassment</option>
          <option value="spam">Spam</option>
          <option value="inappropriate">Inappropriate</option>
          <option value="safety">Safety</option>
          <option value="other">Other</option>
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Send report
        </Button>
        <Note state={state} />
      </form>
    </details>
  );
}

export function SquadRunForm({ squadId, minDate }: { squadId: string; minDate: string }) {
  const [state, action, pending] = useActionState(addSquadRun, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="squadId" value={squadId} />
      <div className="space-y-1">
        <Label htmlFor="sr-title">Run</Label>
        <Input id="sr-title" name="title" required maxLength={80} placeholder="Saturday lake loop" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sr-where">Meeting point</Label>
        <Input id="sr-where" name="meetingPoint" required maxLength={120} placeholder="A public place" />
      </div>
      <div className="flex gap-2">
        <div className="space-y-1">
          <Label htmlFor="sr-date">Date</Label>
          <Input id="sr-date" name="date" type="date" required min={minDate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sr-time">Time (IST)</Label>
          <Input id="sr-time" name="time" type="time" required defaultValue="06:00" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sr-notes">Notes (optional)</Label>
        <Input id="sr-notes" name="notes" maxLength={500} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          Add to calendar
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
