"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  reportConditionAction,
  resolveConditionAction,
  reviewRouteAction,
  updateRouteAction,
  uploadGpxRouteAction,
  type RouteFormState,
} from "../actions";
import {
  DIFFICULTY_LABEL,
  LIGHTING_LABEL,
  REPORT_KIND_LABEL,
  SHADE_LABEL,
  SURFACE_LABEL,
  TERRAIN_LABEL,
} from "../logic";

const idle: RouteFormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Note({ state }: { state: RouteFormState }) {
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

function Select({
  id,
  label,
  name,
  options,
  value,
}: {
  id: string;
  label: string;
  name: string;
  options: Record<string, string>;
  value: string;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={value} className={selectClass}>
        {Object.entries(options).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

const YES_NO = { unknown: "Unknown", yes: "Yes", no: "No" };
const triValue = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

export function GpxUploadForm({ canPublish }: { canPublish: boolean }) {
  const [state, action, pending] = useActionState(uploadGpxRouteAction, idle);
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-card p-4">
      <label className="grid gap-1 text-sm">
        Route name
        <Input name="name" required maxLength={120} placeholder="Gachibowli stadium loop" />
      </label>
      <label className="grid gap-1 text-sm">
        Area (optional)
        <Input name="area" maxLength={80} placeholder="Gachibowli" />
      </label>
      <label className="grid gap-1 text-sm">
        Description (optional)
        <Textarea name="description" maxLength={3000} />
      </label>
      <label className="grid gap-1 text-sm">
        GPX file (up to 2.5 MB)
        <input name="gpx" type="file" accept=".gpx,application/gpx+xml" required className="text-sm" />
      </label>
      {canPublish && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" /> Publish straight away
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        Only upload a track you recorded or have the right to share. Distance and loop detection are calculated from the
        track; elevation is shown only if the file contains it. New routes are unverified until a programme manager
        checks them.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload route"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function RouteAttributesForm({
  route,
  isManager,
}: {
  route: {
    id: string;
    slug: string;
    surface: string;
    terrain: string;
    difficulty: string;
    lighting: string;
    shade: string;
    beginnerSuitable: boolean | null;
    waterRefill: boolean | null;
    toilets: boolean | null;
    parking: string | null;
    meetingPoint: string | null;
    trafficNotes: string | null;
    status: string;
    verified: boolean;
  };
  isManager: boolean;
}) {
  const [state, action, pending] = useActionState(updateRouteAction, idle);
  const p = `route-${route.id}`;
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="routeId" value={route.id} />
      <input type="hidden" name="slug" value={route.slug} />
      <Select id={`${p}-surface`} label="Surface" name="surface" options={SURFACE_LABEL} value={route.surface} />
      <Select id={`${p}-terrain`} label="Terrain" name="terrain" options={TERRAIN_LABEL} value={route.terrain} />
      <Select
        id={`${p}-difficulty`}
        label="Difficulty"
        name="difficulty"
        options={DIFFICULTY_LABEL}
        value={route.difficulty}
      />
      <Select id={`${p}-lighting`} label="Lighting" name="lighting" options={LIGHTING_LABEL} value={route.lighting} />
      <Select id={`${p}-shade`} label="Shade" name="shade" options={SHADE_LABEL} value={route.shade} />
      <Select
        id={`${p}-beginner`}
        label="Suits beginners"
        name="beginnerSuitable"
        options={YES_NO}
        value={triValue(route.beginnerSuitable)}
      />
      <Select
        id={`${p}-water`}
        label="Water refill"
        name="waterRefill"
        options={YES_NO}
        value={triValue(route.waterRefill)}
      />
      <Select
        id={`${p}-toilets`}
        label="Public toilets"
        name="toilets"
        options={YES_NO}
        value={triValue(route.toilets)}
      />
      <label className="grid gap-1 text-sm">
        Parking
        <Input name="parking" maxLength={200} defaultValue={route.parking ?? ""} />
      </label>
      <label className="grid gap-1 text-sm">
        Meeting point
        <Input name="meetingPoint" maxLength={200} defaultValue={route.meetingPoint ?? ""} />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Traffic and road notes
        <Input name="trafficNotes" maxLength={500} defaultValue={route.trafficNotes ?? ""} />
      </label>
      {isManager && (
        <>
          <Select
            id={`${p}-status`}
            label="Status"
            name="status"
            options={{ draft: "Draft", published: "Published", archived: "Archived" }}
            value={route.status}
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="hidden" name="verified" value="" />
            <input type="checkbox" name="verified" defaultChecked={route.verified} /> Verified on the ground
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-2">Leave anything you have not checked as Unknown.</p>
      <Button type="submit" disabled={pending} className="sm:justify-self-start">
        {pending ? "Saving…" : "Save route details"}
      </Button>
      <div className="sm:col-span-2">
        <Note state={state} />
      </div>
    </form>
  );
}

const STARS = { "": "Not rated", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" };

export function ReviewForm({
  routeId,
  slug,
  mine,
}: {
  routeId: string;
  slug: string;
  mine: {
    rating: number;
    safety: number | null;
    shade: number | null;
    surface: number | null;
    crowd: number | null;
    comment: string | null;
  } | null;
}) {
  const [state, action, pending] = useActionState(reviewRouteAction, idle);
  const v = (n: number | null | undefined) => (n ? String(n) : "");
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-5">
      <input type="hidden" name="routeId" value={routeId} />
      <input type="hidden" name="slug" value={slug} />
      <Select
        id={`${routeId}-rating`}
        label="Overall (1–5)"
        name="rating"
        options={{ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" }}
        value={v(mine?.rating) || "4"}
      />
      <Select id={`${routeId}-safety`} label="Feels safe" name="safety" options={STARS} value={v(mine?.safety)} />
      <Select id={`${routeId}-shade`} label="Shade" name="shade" options={STARS} value={v(mine?.shade)} />
      <Select id={`${routeId}-surface`} label="Surface" name="surface" options={STARS} value={v(mine?.surface)} />
      <Select id={`${routeId}-crowd`} label="Not crowded" name="crowd" options={STARS} value={v(mine?.crowd)} />
      <label className="grid gap-1 text-sm sm:col-span-5">
        Comment (optional, shown without your name)
        <Textarea name="comment" maxLength={1000} defaultValue={mine?.comment ?? ""} />
      </label>
      <Button type="submit" disabled={pending} className="sm:justify-self-start">
        {pending ? "Saving…" : mine ? "Update review" : "Post review"}
      </Button>
      <div className="sm:col-span-4">
        <Note state={state} />
      </div>
    </form>
  );
}

export function ConditionReportForm({ routeId, slug }: { routeId: string; slug: string }) {
  const [state, action, pending] = useActionState(reportConditionAction, idle);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[12rem_1fr]">
      <input type="hidden" name="routeId" value={routeId} />
      <input type="hidden" name="slug" value={slug} />
      <Select id={`${routeId}-kind`} label="What did you see?" name="kind" options={REPORT_KIND_LABEL} value="hazard" />
      <label className="grid gap-1 text-sm">
        Details
        <Input name="note" required minLength={3} maxLength={500} placeholder="Pothole near the second bend" />
      </label>
      <Button type="submit" disabled={pending} variant="outline" className="sm:justify-self-start">
        {pending ? "Sending…" : "Report a condition"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ResolveReportButton({ reportId, slug }: { reportId: string; slug: string }) {
  const [state, action, pending] = useActionState(resolveConditionAction, idle);
  return (
    <form action={action}>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Mark resolved
      </Button>
      <Note state={state} />
    </form>
  );
}
