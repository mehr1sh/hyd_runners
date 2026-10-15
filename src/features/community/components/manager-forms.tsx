"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  assignCoachAction,
  grantRoleAction,
  removeAssignmentAction,
  revokeRoleAction,
  saveAnnouncementAction,
  saveEventAction,
  saveLocationAction,
  saveLocationUpdateAction,
  type FormState,
} from "../actions";
import { isoToLocalInput } from "../logic/dates";

const idle: FormState = { status: "idle" };
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <Alert
      variant={state.status === "error" ? "destructive" : "default"}
      role={state.status === "error" ? "alert" : "status"}
    >
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function AnnouncementForm({
  announcement,
}: {
  announcement?: {
    id: string;
    title: string;
    body: string;
    audience: string;
    audienceId: string | null;
    publishAt: string;
  };
}) {
  const [state, action, pending] = useActionState(saveAnnouncementAction, idle);
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      {announcement && <input type="hidden" name="id" value={announcement.id} />}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={announcement ? `title-${announcement.id}` : "announcement-title"}>Title</FieldLabel>
          <Input
            id={announcement ? `title-${announcement.id}` : "announcement-title"}
            name="title"
            required
            maxLength={120}
            defaultValue={announcement?.title}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={announcement ? `body-${announcement.id}` : "announcement-body"}>Body</FieldLabel>
          <Textarea
            id={announcement ? `body-${announcement.id}` : "announcement-body"}
            name="body"
            required
            maxLength={5000}
            defaultValue={announcement?.body}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={announcement ? `audience-${announcement.id}` : "audience"}>Audience</FieldLabel>
          <select
            id={announcement ? `audience-${announcement.id}` : "audience"}
            name="audience"
            defaultValue={announcement?.audience ?? "everyone"}
            className={selectClass}
          >
            <option value="everyone">Everyone</option>
            <option value="programme">Programme (staff only until enrolments exist)</option>
            <option value="coach_group">Coach group</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={announcement ? `publish-${announcement.id}` : "publishAt"}>Publish at</FieldLabel>
          <Input
            id={announcement ? `publish-${announcement.id}` : "publishAt"}
            name="publishAt"
            type="datetime-local"
            defaultValue={announcement ? isoToLocalInput(announcement.publishAt) : ""}
          />
        </Field>
      </FieldGroup>
      <Note state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : announcement ? "Save announcement" : "Publish announcement"}
      </Button>
    </form>
  );
}

export function EventForm({
  event,
  locations,
}: {
  event?: {
    id: string;
    title: string;
    description: string;
    startsAt: string;
    endsAt: string;
    locationId: string | null;
    capacity: number | null;
    status: string;
  };
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveEventAction, idle);
  const idPrefix = event?.id ?? "new-event";
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      {event && <input type="hidden" name="id" value={event.id} />}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-title`}>Title</FieldLabel>
          <Input id={`${idPrefix}-title`} name="title" required maxLength={120} defaultValue={event?.title} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-description`}>Description</FieldLabel>
          <Textarea
            id={`${idPrefix}-description`}
            name="description"
            maxLength={5000}
            defaultValue={event?.description}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-start`}>Starts</FieldLabel>
            <Input
              id={`${idPrefix}-start`}
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={event ? isoToLocalInput(event.startsAt) : ""}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-end`}>Ends</FieldLabel>
            <Input
              id={`${idPrefix}-end`}
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={event ? isoToLocalInput(event.endsAt) : ""}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-location`}>Location</FieldLabel>
          <select
            id={`${idPrefix}-location`}
            name="locationId"
            defaultValue={event?.locationId ?? ""}
            className={selectClass}
          >
            <option value="">No location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-capacity`}>Capacity</FieldLabel>
          <Input
            id={`${idPrefix}-capacity`}
            name="capacity"
            type="number"
            min={1}
            defaultValue={event?.capacity ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-status`}>Status</FieldLabel>
          <select
            id={`${idPrefix}-status`}
            name="status"
            defaultValue={event?.status ?? "draft"}
            className={selectClass}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
      </FieldGroup>
      <Note state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : event ? "Save event" : "Create event"}
      </Button>
    </form>
  );
}

export function LocationUpdateForm({
  locations,
  update,
}: {
  locations: { id: string; name: string }[];
  update?: { id: string; locationId: string; title: string; body: string; publishAt: string };
}) {
  const [state, action, pending] = useActionState(saveLocationUpdateAction, idle);
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      {update && <input type="hidden" name="id" value={update.id} />}
      <Field>
        <FieldLabel htmlFor={update ? `loc-${update.id}` : "locationId"}>Location</FieldLabel>
        <select
          id={update ? `loc-${update.id}` : "locationId"}
          name="locationId"
          required
          defaultValue={update?.locationId ?? ""}
          className={selectClass}
        >
          <option value="" disabled>
            Choose a location
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor={update ? `lu-title-${update.id}` : "lu-title"}>Title</FieldLabel>
        <Input
          id={update ? `lu-title-${update.id}` : "lu-title"}
          name="title"
          required
          maxLength={120}
          defaultValue={update?.title}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={update ? `lu-body-${update.id}` : "lu-body"}>Update</FieldLabel>
        <Textarea
          id={update ? `lu-body-${update.id}` : "lu-body"}
          name="body"
          required
          maxLength={2000}
          defaultValue={update?.body}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={update ? `lu-publish-${update.id}` : "lu-publish"}>Publish at</FieldLabel>
        <Input
          id={update ? `lu-publish-${update.id}` : "lu-publish"}
          name="publishAt"
          type="datetime-local"
          defaultValue={update ? isoToLocalInput(update.publishAt) : ""}
        />
      </Field>
      <Note state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Publish location update"}
      </Button>
    </form>
  );
}

export function LocationForm() {
  const [state, action, pending] = useActionState(saveLocationAction, idle);
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="location-name">Name</FieldLabel>
          <Input id="location-name" name="name" required maxLength={120} />
        </Field>
        <Field>
          <FieldLabel htmlFor="kind">Kind</FieldLabel>
          <select id="kind" name="kind" defaultValue="park" className={selectClass}>
            <option value="park">Park</option>
            <option value="track">Track</option>
            <option value="lake_loop">Lake loop</option>
            <option value="gym">Gym</option>
            <option value="trail">Trail</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="latitude">Latitude</FieldLabel>
            <Input id="latitude" name="latitude" type="number" step="0.000001" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="longitude">Longitude</FieldLabel>
            <Input id="longitude" name="longitude" type="number" step="0.000001" required />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="address">Address</FieldLabel>
          <Input id="address" name="address" maxLength={200} />
        </Field>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name="verified" value="yes" className="size-4 accent-[#C8161D]" />
          Mark as verified
        </label>
      </FieldGroup>
      <Note state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Add location"}
      </Button>
    </form>
  );
}

export function PeopleForms({
  people,
  assignments,
}: {
  people: { id: string; displayName: string; roles: string[] }[];
  assignments: { id: string; coachId: string; runnerId: string }[];
}) {
  const staff = people.filter((person) => person.roles.some((role) => role === "coach" || role === "mentor"));
  const [grantState, grantAction, grantPending] = useActionState(grantRoleAction, idle);
  const [assignState, assignAction, assignPending] = useActionState(assignCoachAction, idle);
  const name = (id: string) => people.find((person) => person.id === id)?.displayName ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <form
        action={grantAction}
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
      >
        <label className="grid gap-1 text-sm">
          Person
          <select name="userId" required className={selectClass} defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Role
          <select name="role" className={selectClass} defaultValue="coach">
            <option value="coach">Coach</option>
            <option value="mentor">Mentor</option>
          </select>
        </label>
        <Button type="submit" disabled={grantPending}>
          {grantPending ? "Granting…" : "Grant role"}
        </Button>
        <Note state={grantState} />
      </form>
      <form action={assignAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end">
        <label className="grid gap-1 text-sm">
          Coach or mentor
          <select name="coachId" required className={selectClass} defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Runner
          <select name="runnerId" required className={selectClass} defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={assignPending || staff.length === 0}>
          {assignPending ? "Assigning…" : "Assign"}
        </Button>
        <Note state={assignState} />
      </form>
      <ul className="divide-y rounded-xl border bg-card">
        {assignments.length === 0 && <li className="p-4 text-sm text-muted-foreground">No coach assignments yet.</li>}
        {assignments.map((assignment) => (
          <li key={assignment.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>
              {name(assignment.coachId)} → {name(assignment.runnerId)}
            </span>
            <form action={removeAssignmentAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <Button type="submit" variant="outline" size="sm">
                Remove
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <ul className="divide-y rounded-xl border bg-card">
        {people.map((person) => (
          <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <span className="font-medium text-brand-navy">{person.displayName}</span>
            <span className="text-muted-foreground">{person.roles.join(", ") || "runner"}</span>
            {person.roles.includes("coach") && (
              <form action={revokeRoleAction}>
                <input type="hidden" name="userId" value={person.id} />
                <input type="hidden" name="role" value="coach" />
                <Button type="submit" variant="ghost" size="sm">
                  Revoke coach
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
