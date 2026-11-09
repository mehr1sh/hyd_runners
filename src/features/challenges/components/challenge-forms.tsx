"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cancelChallengeAction, createChallengeAction, joinChallengeAction, type ChallengeFormState } from "../actions";
import { CHALLENGE_KIND } from "../logic";

const idle: ChallengeFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: ChallengeFormState }) {
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

export function JoinButton({
  challengeId,
  joined,
  completed,
}: {
  challengeId: string;
  joined: boolean;
  completed: boolean;
}) {
  const [state, action, pending] = useActionState(joinChallengeAction, idle);
  if (completed) return <p className="text-sm font-medium text-brand-navy">Completed ✓</p>;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="challengeId" value={challengeId} />
      <input type="hidden" name="intent" value={joined ? "leave" : "join"} />
      <Button type="submit" size="sm" variant={joined ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : joined ? "Leave" : "Join challenge"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function CancelChallenge({ challengeId }: { challengeId: string }) {
  const [state, action, pending] = useActionState(cancelChallengeAction, idle);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="challengeId" value={challengeId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Cancel challenge
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ChallengeForm({ clubId, today }: { clubId: string | null; today: string }) {
  const [state, action, pending] = useActionState(createChallengeAction, idle);
  const p = clubId ?? "city";
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
      {clubId && <input type="hidden" name="clubId" value={clubId} />}
      <label className="grid gap-1 text-sm sm:col-span-2">
        Challenge name
        <Input name="title" required maxLength={100} placeholder="November consistency" />
      </label>
      <div className="grid gap-1 text-sm">
        <label htmlFor={`kind-${p}`}>What counts</label>
        <select id={`kind-${p}`} name="kind" defaultValue="active_days" className={selectClass}>
          {Object.entries(CHALLENGE_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}: {v.help}
            </option>
          ))}
        </select>
      </div>
      <label className="grid gap-1 text-sm">
        Goal (km for distance challenges)
        <Input name="goal" type="number" min={0.1} step="any" required defaultValue={12} />
      </label>
      <label className="grid gap-1 text-sm">
        Starts
        <Input name="startsOn" type="date" required defaultValue={today} />
      </label>
      <label className="grid gap-1 text-sm">
        Ends
        <Input name="endsOn" type="date" required />
      </label>
      <label className="grid gap-1 text-sm">
        Reward (XP, up to 500)
        <Input name="rewardXp" type="number" min={0} max={500} defaultValue={50} />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="collective" /> Group goal (everyone&apos;s progress adds up)
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Description
        <Textarea name="description" maxLength={1000} />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Progress comes from logged and imported activities, counted once each. Activities under 10 minutes and logs
        added more than 3 days after the end don&apos;t count, and distance counts at most 50 km a day.
      </p>
      <Button type="submit" disabled={pending} className="sm:justify-self-start">
        {pending ? "Creating…" : "Create challenge"}
      </Button>
      <div className="sm:col-span-2">
        <Note state={state} />
      </div>
    </form>
  );
}
