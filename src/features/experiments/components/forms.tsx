"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setCause, setMystery, startRelay, verifyCause, type ExpState } from "../actions";
import { JOURNEYS } from "../logic";

const idle: ExpState = { status: "idle" };
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
function Note({ state }: { state: ExpState }) {
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

export function RelayForm({ squadId, today }: { squadId: string; today: string }) {
  const [state, action, pending] = useActionState(startRelay, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3 sm:items-end">
      <input type="hidden" name="squadId" value={squadId} />
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="rl-j">Journey</Label>
        <select id="rl-j" name="journey" className={sel}>
          {Object.entries(JOURNEYS).map(([k, j]) => (
            <option key={k} value={k}>
              {j.name} ({j.km.toLocaleString("en-IN")} km)
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rl-d">Counting from</Label>
        <Input id="rl-d" name="startsOn" type="date" defaultValue={today} max={today} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          Start relay
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function MysteryForm({
  eventId,
  routes,
  current,
}: {
  eventId: string;
  routes: { id: string; name: string }[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState(setMystery, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="my-r">Hidden route</Label>
        <select id="my-r" name="routeId" className={sel} defaultValue={current ?? ""}>
          <option value="">Not a mystery run</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="my-d">Reveal on</Label>
        <Input id="my-d" name="revealDate" type="date" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="my-t">at (IST)</Label>
        <Input id="my-t" name="revealTime" type="time" defaultValue="05:00" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          Save mystery route
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function CauseForm({ challengeId, name, url }: { challengeId: string; name: string; url: string }) {
  const [state, action, pending] = useActionState(setCause, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3 sm:items-end">
      <input type="hidden" name="challengeId" value={challengeId} />
      <Input name="name" defaultValue={name} maxLength={120} placeholder="Campaign name" aria-label="Campaign name" />
      <Input name="url" defaultValue={url} maxLength={300} placeholder="https://" aria-label="Campaign link" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save cause
      </Button>
      <div className="sm:col-span-3">
        <Note state={state} />
      </div>
    </form>
  );
}

export function VerifyCauseForm({ challengeId }: { challengeId: string }) {
  const [state, action, pending] = useActionState(verifyCause, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="challengeId" value={challengeId} />
      <Button type="submit" name="decision" value="verify" size="sm" disabled={pending}>
        Verify campaign
      </Button>
      <Button type="submit" name="decision" value="reject" size="sm" variant="outline" disabled={pending}>
        Reject
      </Button>
      <Note state={state} />
    </form>
  );
}
