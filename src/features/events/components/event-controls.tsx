"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { rsvpAction, type RsvpState } from "@/features/community/actions";
import { choosePaceGroupAction, type EventFormState } from "../actions";
import { countdown, countdownLabel, paceRangeLabel, type RsvpStatus } from "../logic";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Live countdown. Starts from the server's label so hydration matches. */
export function Countdown({ startsAt, initial }: { startsAt: string; initial: string | null }) {
  const [label, setLabel] = useState(initial);
  useEffect(() => {
    const tick = () => setLabel(countdownLabel(countdown(Date.now(), startsAt)));
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [startsAt]);
  if (!label) return null;
  return (
    <p className="text-sm font-medium text-brand-red-strong" aria-live="off">
      {label}
    </p>
  );
}

/** RSVP, waiting list and cancellation in one control. */
export function RsvpControl({
  eventId,
  status,
  full,
  open,
  waitlistPosition,
}: {
  eventId: string;
  status: RsvpStatus | null;
  full: boolean;
  open: boolean;
  waitlistPosition: number | null;
}) {
  const [state, formAction, pending] = useActionState(rsvpAction, { status: "idle" } as RsvpState);
  const active = status === "going" || status === "waitlisted";
  const next: RsvpStatus = active ? "cancelled" : full ? "waitlisted" : "going";
  const label = pending
    ? "Saving…"
    : status === "going"
      ? "Cancel my place"
      : status === "waitlisted"
        ? "Leave the waiting list"
        : full
          ? "Join the waiting list"
          : "I'm going";
  return (
    <form action={formAction} className="flex flex-col items-start gap-1 sm:items-end">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="status" value={next} />
      {status === "waitlisted" && waitlistPosition !== null && (
        <p className="text-xs text-muted-foreground">You&apos;re number {waitlistPosition} on the waiting list.</p>
      )}
      <Button type="submit" size="sm" variant={active ? "outline" : "default"} disabled={pending || (!active && !open)}>
        {!active && !open ? "Registration closed" : label}
      </Button>
      <p
        aria-live="polite"
        className={`text-xs ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {state.message ?? ""}
      </p>
    </form>
  );
}

export function PaceGroupPicker({
  eventId,
  groups,
  current,
}: {
  eventId: string;
  groups: { id: string; label: string; minPace: number | null; maxPace: number | null; runWalk: boolean }[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState(choosePaceGroupAction, { status: "idle" } as EventFormState);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="eventId" value={eventId} />
      <label className="grid gap-1 text-sm">
        Your pace group
        <select name="paceGroupId" defaultValue={current ?? ""} className={selectClass}>
          <option value="">Not sure yet</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} ({paceRangeLabel(g.minPace, g.maxPace, g.runWalk)})
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`text-xs sm:col-span-2 ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
