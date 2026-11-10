"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addTeamMemberAction,
  checkInAction,
  deletePaceGroupAction,
  postEventUpdateAction,
  recordResultAction,
  removeTeamMemberAction,
  savePaceGroupAction,
  setVolunteerTaskAction,
  setPaceGroupLeaderAction,
  type EventFormState,
} from "../actions";
import { formatDuration, paceRangeLabel, TEAM_ROLE_LABEL, type TeamRole } from "../logic";
import type { PaceGroup, RosterEntry } from "../queries";

const idle: EventFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: EventFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`text-xs ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {state.message}
    </p>
  );
}

export function Roster({
  eventId,
  roster,
  paceGroups,
  canManage,
}: {
  eventId: string;
  roster: RosterEntry[];
  paceGroups: PaceGroup[];
  canManage: boolean;
}) {
  if (roster.length === 0) {
    return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nobody has signed up yet.</p>;
  }
  const groupName = new Map(paceGroups.map((g) => [g.id, g.label]));
  const going = roster.filter((r) => r.status === "going");
  const checkedIn = going.filter((r) => r.checkedIn).length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground" role="status">
        {checkedIn} of {going.length} checked in · {roster.length - going.length} on the waiting list
      </p>
      <ul className="divide-y rounded-xl border bg-card" aria-label="Roster">
        {roster.map((r) => (
          <li key={r.userId} className="space-y-2 p-3 text-sm" aria-label={r.displayName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-brand-navy">{r.displayName}</span>
              {r.status === "waitlisted" && <Badge variant="outline">Waiting list</Badge>}
              {r.teamRole && <Badge variant="secondary">{TEAM_ROLE_LABEL[r.teamRole]}</Badge>}
              {r.paceGroupId && <span className="text-xs text-muted-foreground">{groupName.get(r.paceGroupId)}</span>}
              {r.result && (
                <span className="text-xs text-muted-foreground">
                  {r.result.outcome === "finished"
                    ? `Finished${r.result.finishSeconds ? ` in ${formatDuration(r.result.finishSeconds)}` : ""}`
                    : r.result.outcome.toUpperCase()}
                </span>
              )}
            </div>
            {r.status === "going" && (
              <div className="flex flex-wrap items-start gap-3">
                <CheckInToggle eventId={eventId} userId={r.userId} checkedIn={r.checkedIn} name={r.displayName} />
                {canManage && <ResultForm eventId={eventId} userId={r.userId} name={r.displayName} />}
                {canManage && !r.teamRole && (
                  <MakeTeamMember eventId={eventId} userId={r.userId} name={r.displayName} />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckInToggle({
  eventId,
  userId,
  checkedIn,
  name,
}: {
  eventId: string;
  userId: string;
  checkedIn: boolean;
  name: string;
}) {
  const [state, action, pending] = useActionState(checkInAction, idle);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="present" value={checkedIn ? "false" : "true"} />
      <Button
        type="submit"
        size="sm"
        variant={checkedIn ? "outline" : "default"}
        disabled={pending}
        aria-label={checkedIn ? `Undo check-in for ${name}` : `Check in ${name}`}
      >
        {pending ? "Saving…" : checkedIn ? "Checked in ✓" : "Check in"}
      </Button>
      <Note state={state} />
    </form>
  );
}

function ResultForm({ eventId, userId, name }: { eventId: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(recordResultAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" aria-label={`Result for ${name}`}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="userId" value={userId} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Outcome
        <select name="outcome" defaultValue="finished" className={selectClass}>
          <option value="finished">Finished</option>
          <option value="dnf">Did not finish</option>
          <option value="dns">Did not start</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Time (optional)
        <Input name="finishTime" placeholder="mm:ss" className="h-9 w-24" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save result"}
      </Button>
      <Note state={state} />
    </form>
  );
}

function MakeTeamMember({ eventId, userId, name }: { eventId: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(addTeamMemberAction, idle);
  return (
    <form action={action} className="flex items-end gap-2" aria-label={`Team role for ${name}`}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="userId" value={userId} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Team role
        <select name="role" defaultValue="captain" className={selectClass}>
          <option value="captain">Run captain</option>
          <option value="sweeper">Sweeper</option>
          <option value="volunteer">Volunteer</option>
        </select>
      </label>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Add
      </Button>
      <Note state={state} />
    </form>
  );
}

function VolunteerTask({ eventId, userId, task }: { eventId: string; userId: string; task: string }) {
  const [state, action, pending] = useActionState(setVolunteerTaskAction, idle);
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-1">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="userId" value={userId} />
      <Input
        name="task"
        defaultValue={task}
        maxLength={120}
        placeholder="e.g. Water station, km 5"
        aria-label="Volunteer task"
        className="h-8 w-56"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save task
      </Button>
      {state.message && <span className="text-xs text-muted-foreground">{state.message}</span>}
    </form>
  );
}

export function TeamList({
  eventId,
  team,
  canManage,
  staff,
}: {
  eventId: string;
  team: { userId: string; displayName: string; role: TeamRole; task?: string | null }[];
  canManage: boolean;
  staff: { id: string; displayName: string }[] | null;
}) {
  const [state, action, pending] = useActionState(addTeamMemberAction, idle);
  return (
    <div className="space-y-3">
      {team.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Event team">
          {team.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 p-3">
              <span>
                {m.displayName} <span className="text-muted-foreground">· {TEAM_ROLE_LABEL[m.role]}</span>
                {m.role === "volunteer" && !canManage && m.task && (
                  <span className="block text-xs">Task: {m.task}</span>
                )}
                {m.role === "volunteer" && canManage && (
                  <VolunteerTask eventId={eventId} userId={m.userId} task={m.task ?? ""} />
                )}
              </span>
              {canManage && <RemoveTeamMember eventId={eventId} userId={m.userId} name={m.displayName} />}
            </li>
          ))}
        </ul>
      )}
      {staff && (
        <form
          action={action}
          className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <label className="grid gap-1 text-sm">
            Add an organiser or captain
            <select name="userId" required defaultValue="" className={selectClass}>
              <option value="" disabled>
                Choose a staff member
              </option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Role
            <select name="role" defaultValue="organiser" className={selectClass}>
              <option value="organiser">Organiser</option>
              <option value="captain">Run captain</option>
              <option value="sweeper">Sweeper</option>
              <option value="volunteer">Volunteer</option>
              <option value="volunteer">Volunteer</option>
            </select>
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
          <div className="sm:col-span-3">
            <Note state={state} />
          </div>
        </form>
      )}
    </div>
  );
}

function RemoveTeamMember({ eventId, userId, name }: { eventId: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(removeTeamMemberAction, idle);
  return (
    <form action={action}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${name} from the team`}>
        Remove
      </Button>
      <Note state={state} />
    </form>
  );
}

function LeaderPicker({
  eventId,
  group,
  team,
}: {
  eventId: string;
  group: PaceGroup;
  team: { userId: string; displayName: string; role: string }[];
}) {
  const [state, action, pending] = useActionState(setPaceGroupLeaderAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="paceGroupId" value={group.id} />
      <select
        name="leaderId"
        defaultValue={group.leaderId ?? ""}
        aria-label={`Leader of ${group.label}`}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">No leader</option>
        {team.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.displayName}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Set leader
      </Button>
      {state.message && (
        <span role={state.status === "error" ? "alert" : "status"} className="text-xs text-muted-foreground">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function PaceGroupManager({
  eventId,
  groups,
  team = [],
}: {
  eventId: string;
  groups: PaceGroup[];
  team?: { userId: string; displayName: string; role: string }[];
}) {
  const [state, action, pending] = useActionState(savePaceGroupAction, idle);
  return (
    <div className="space-y-3">
      {groups.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Pace groups">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium text-brand-navy">{g.label}</span>{" "}
                <span className="text-muted-foreground">{paceRangeLabel(g.minPace, g.maxPace, g.runWalk)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {team.length > 0 && <LeaderPicker eventId={eventId} group={g} team={team} />}
                <DeletePaceGroup eventId={eventId} paceGroupId={g.id} label={g.label} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-4 sm:items-end">
        <input type="hidden" name="eventId" value={eventId} />
        <label className="grid gap-1 text-sm sm:col-span-2">
          Pace group name
          <Input name="label" required maxLength={60} placeholder="e.g. Steady 6:00–6:30" />
        </label>
        <label className="grid gap-1 text-sm">
          Fastest (min/km)
          <Input name="minPace" placeholder="6:00" />
        </label>
        <label className="grid gap-1 text-sm">
          Slowest (min/km)
          <Input name="maxPace" placeholder="6:30" />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="runWalk" /> Run-walk group (no pace range)
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Notes (optional)
          <Input name="notes" maxLength={300} placeholder="Regroup at every 2 km" />
        </label>
        <Button type="submit" disabled={pending} className="sm:col-span-4 sm:justify-self-start">
          {pending ? "Adding…" : "Add pace group"}
        </Button>
        <div className="sm:col-span-4">
          <Note state={state} />
        </div>
      </form>
    </div>
  );
}

function DeletePaceGroup({ eventId, paceGroupId, label }: { eventId: string; paceGroupId: string; label: string }) {
  const [state, action, pending] = useActionState(deletePaceGroupAction, idle);
  return (
    <form action={action}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="paceGroupId" value={paceGroupId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={`Remove pace group ${label}`}>
        Remove
      </Button>
      <Note state={state} />
    </form>
  );
}

export function UpdateComposer({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(postEventUpdateAction, idle);
  return (
    <form action={action} className="space-y-2 rounded-xl border bg-card p-3">
      <input type="hidden" name="eventId" value={eventId} />
      <label className="grid gap-1 text-sm" htmlFor={`update-${eventId}`}>
        Post an update to everyone on this event page
      </label>
      <Textarea
        id={`update-${eventId}`}
        name="body"
        required
        maxLength={2000}
        placeholder="Route change, weather, what to bring…"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post update"}
      </Button>
      <Note state={state} />
    </form>
  );
}
