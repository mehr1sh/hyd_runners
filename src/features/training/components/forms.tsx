"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkAdaptive,
  closeRaceGoal,
  decideProposal,
  proposeForMissed,
  proposeRacePlan,
  saveRaceGoal,
  type TrainingState,
} from "../actions";

const idle: TrainingState = { status: "idle" };
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function Note({ state }: { state: TrainingState }) {
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

export function RaceGoalForm({
  defaultLevel,
  minDate,
  maxDate,
}: {
  defaultLevel: string;
  minDate: string;
  maxDate: string;
}) {
  const [state, action, pending] = useActionState(saveRaceGoal, idle);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="goal-distance">Distance</Label>
        <select id="goal-distance" name="distance" className={selectClass} defaultValue="10k">
          <option value="5k">5K</option>
          <option value="10k">10K</option>
          <option value="half">Half marathon</option>
          <option value="marathon">Marathon</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-date">Race date</Label>
        <Input id="goal-date" name="raceDate" type="date" required min={minDate} max={maxDate} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-name">Race name (optional)</Label>
        <Input id="goal-name" name="name" maxLength={120} placeholder="Hyderabad 10K" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-target">Target time (optional)</Label>
        <Input id="goal-target" name="target" inputMode="numeric" placeholder="h:mm:ss or mm:ss" maxLength={10} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-level">Your running now</Label>
        <select id="goal-level" name="level" className={selectClass} defaultValue={defaultLevel}>
          <option value="new_to_running">New to running</option>
          <option value="returning">Returning or occasional</option>
          <option value="regular">Running regularly</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-days">Training days per week</Label>
        <select id="goal-days" name="daysPerWeek" className={selectClass} defaultValue="4">
          {[2, 3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-long">Long-run day</Label>
        <select id="goal-long" name="longRunDay" className={selectClass} defaultValue="7">
          {DAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save race goal"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function SimpleAction({
  kind,
  label,
  fields = {},
  variant = "default",
}: {
  kind: "plan" | "adaptive" | "missed" | "complete" | "abandon";
  label: string;
  fields?: Record<string, string>;
  variant?: "default" | "outline" | "ghost";
}) {
  const fn = {
    plan: proposeRacePlan,
    adaptive: checkAdaptive,
    missed: proposeForMissed,
    complete: closeRaceGoal,
    abandon: closeRaceGoal,
  }[kind];
  const [state, action, pending] = useActionState(
    fn as (s: TrainingState, f: FormData) => Promise<TrainingState>,
    idle,
  );
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {kind === "complete" && <input type="hidden" name="outcome" value="completed" />}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? "Working…" : label}
      </Button>
      <Note state={state} />
    </form>
  );
}

export type ReviewChange = { index: number; label: string; group: string };

/** Accept all or some changes, or reject the proposal. */
export function ProposalReview({ id, changes }: { id: string; changes: ReviewChange[] }) {
  const [state, action, pending] = useActionState(decideProposal, idle);
  const [kept, setKept] = useState<Set<number>>(() => new Set(changes.map((c) => c.index)));
  const groups = [...new Set(changes.map((c) => c.group))];
  const toggle = (i: number) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="proposalId" value={id} />
      <input type="hidden" name="total" value={changes.length} />
      {groups.map((g) => {
        const items = changes.filter((c) => c.group === g);
        const body = (
          <ul className="space-y-1">
            {items.map((c) => (
              <li key={c.index}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="keep"
                    value={c.index}
                    checked={kept.has(c.index)}
                    onChange={() => toggle(c.index)}
                    className="mt-1"
                  />
                  <span>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        );
        return groups.length > 1 ? (
          <details key={g} className="rounded-md border p-2">
            <summary className="cursor-pointer text-sm font-medium">
              {g} ({items.filter((c) => kept.has(c.index)).length} of {items.length} selected)
            </summary>
            <div className="mt-2">{body}</div>
          </details>
        ) : (
          <div key={g}>{body}</div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="decision" value="accept" disabled={pending || kept.size === 0}>
          {kept.size === changes.length ? "Accept" : `Accept ${kept.size} selected`}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="outline" disabled={pending}>
          Reject
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
