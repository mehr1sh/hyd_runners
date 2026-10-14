"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { rsvpAction, type RsvpState } from "../actions";

export function RsvpButton({ eventId, going, full }: { eventId: string; going: boolean; full: boolean }) {
  const [state, formAction, pending] = useActionState(rsvpAction, { status: "idle" } as RsvpState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1 sm:items-end">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="status" value={going ? "cancelled" : "going"} />
      <Button type="submit" size="sm" variant={going ? "outline" : "default"} disabled={pending || (!going && full)}>
        {pending ? "Saving…" : going ? "Cancel my place" : full ? "Event full" : "I'm going"}
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
