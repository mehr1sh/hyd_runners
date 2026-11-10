"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addService, addSlot, requestBooking, updateBooking, type MarketState } from "../actions";
import { BOUNDARIES, SERVICE_KINDS } from "../logic";

const idle: MarketState = { status: "idle" };
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Note({ state }: { state: MarketState }) {
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

export function BookingForm({
  services,
  slots,
}: {
  services: { id: string; label: string }[];
  slots: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(requestBooking, idle);
  if (services.length === 0 || slots.length === 0)
    return <p className="text-sm text-muted-foreground">No open times right now.</p>;
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="bk-service">Service</Label>
        <select id="bk-service" name="serviceId" className={selectClass}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="bk-slot">Time</Label>
        <select id="bk-slot" name="slotId" className={selectClass}>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="bk-note">What would you like help with? (optional)</Label>
        <Textarea id="bk-note" name="note" maxLength={500} rows={2} />
      </div>
      <fieldset className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
        <legend className="font-medium">Before you book</legend>
        <ul className="list-disc pl-5">
          {BOUNDARIES.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <label className="mt-2 flex items-start gap-2">
          <input type="checkbox" name="acknowledged" required className="mt-1" />
          <span>
            I&apos;ve read this. For pain, injury or symptoms I&apos;ll see a doctor or a verified physiotherapist.
          </span>
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Request booking
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function BookingAction({
  id,
  action,
  label,
  withNote = false,
  variant = "outline",
}: {
  id: string;
  action: string;
  label: string;
  withNote?: boolean;
  variant?: "default" | "outline" | "ghost";
}) {
  const [state, run, pending] = useActionState(updateBooking, idle);
  return (
    <form action={run} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      {withNote && (
        <Input
          name="note"
          maxLength={500}
          placeholder="Message (optional)"
          aria-label={`Message with ${label.toLowerCase()}`}
          className="h-8 w-48"
        />
      )}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ServiceForm() {
  const [state, action, pending] = useActionState(addService, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="sv-kind">Type</Label>
        <select id="sv-kind" name="kind" className={selectClass} defaultValue="training_consultation">
          {Object.entries(SERVICE_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sv-title">Title</Label>
        <Input id="sv-title" name="title" required maxLength={100} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sv-dur">Length (minutes)</Label>
        <Input id="sv-dur" name="duration" type="number" min={15} max={240} defaultValue={45} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sv-del">Where</Label>
        <select id="sv-del" name="delivery" className={selectClass} defaultValue="in_person">
          <option value="in_person">In person</option>
          <option value="online">Online</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sv-price">Indicative fee in ₹ (optional, paid to you directly)</Label>
        <Input id="sv-price" name="price" type="number" min={0} max={100000} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="sv-desc">Description</Label>
        <Textarea id="sv-desc" name="description" maxLength={1000} rows={2} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          Add service
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function SlotForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addSlot, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="sl-date">Date</Label>
        <Input id="sl-date" name="date" type="date" min={today} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sl-time">Start (IST)</Label>
        <Input id="sl-time" name="time" type="time" defaultValue="07:00" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sl-min">Minutes</Label>
        <Input id="sl-min" name="minutes" type="number" min={15} max={240} defaultValue={60} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sl-where">Where (optional)</Label>
        <Input id="sl-where" name="where" maxLength={120} placeholder="KBR Park gate 1" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          Add open time
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
