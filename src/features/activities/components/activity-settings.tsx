"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { deleteActivityAction, updateActivitySettingsAction, type ActivityFormState } from "../actions";
import { VISIBILITY_LABEL } from "../logic/format";

const idle: ActivityFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function ActivitySettings({
  id,
  visibility,
  trim,
  name,
}: {
  id: string;
  visibility: "private" | "followers" | "public";
  trim: number;
  name: string | null;
}) {
  const [state, action, pending] = useActionState(updateActivitySettingsAction, idle);
  const [delState, del, deleting] = useActionState(deleteActivityAction, idle);
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="id" value={id} />
        <div className="grid gap-1 text-sm">
          <label htmlFor={`name-${id}`}>Name</label>
          <input
            id={`name-${id}`}
            name="name"
            maxLength={120}
            defaultValue={name ?? ""}
            className="h-9 rounded-lg border border-input px-2.5 text-sm"
          />
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor={`vis-${id}`}>Who can see it</label>
          <select id={`vis-${id}`} name="visibility" defaultValue={visibility} className={selectClass}>
            {Object.entries(VISIBILITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor={`trim-${id}`}>Hide the start and end of the route from others</label>
          <select id={`trim-${id}`} name="trim" defaultValue={String(trim)} className={selectClass}>
            <option value="0">Show the whole route</option>
            <option value="200">Hide the first and last 200 m</option>
            <option value="500">Hide the first and last 500 m</option>
            <option value="1000">Hide the first and last 1 km</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Your GPS samples, heart rate and the full route are only ever visible to you.
        </p>
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.message && (
          <p role={state.status === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
            {state.message}
          </p>
        )}
      </form>
      <form action={del}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="outline" size="sm" disabled={deleting}>
          {deleting ? "Deleting…" : "Delete activity"}
        </Button>
        {delState.message && (
          <p role="alert" className="text-sm text-destructive">
            {delState.message}
          </p>
        )}
      </form>
    </div>
  );
}
