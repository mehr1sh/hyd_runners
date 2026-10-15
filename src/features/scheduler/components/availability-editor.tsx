"use client";

import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { deriveFreeFromBusy, GAP_LABEL, validateAvailability } from "../logic/availability";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "../logic/time";
import type { AvailabilityDraft, AvailabilityIssue } from "../logic/types";
import { NativeSelect } from "./native-select";

const newKey = () => crypto.randomUUID();

export function blankDraft(kind: "free" | "busy", weekday: number | null = null): AvailabilityDraft {
  return {
    key: newKey(),
    weekday,
    startTime: null,
    endTime: null,
    kind,
    label: null,
    source: "manual",
    confidence: null,
    uncertainties: [],
    rawText: null,
    confirmed: true,
  };
}

/**
 * Review and edit weekly availability. Extracted rows arrive unconfirmed and
 * show what was read and what is uncertain; the runner must tick each one (or
 * delete it) before saving. Validation runs on every change and again on the
 * server when saving.
 */
export function AvailabilityEditor({
  drafts,
  onChange,
  onSave,
  saving,
  serverIssues,
}: {
  drafts: AvailabilityDraft[];
  onChange: (drafts: AvailabilityDraft[]) => void;
  onSave: () => void;
  saving: boolean;
  serverIssues: AvailabilityIssue[] | null;
}) {
  const check = useMemo(
    () => validateAvailability(drafts, { requireConfirmed: true, requireFreeTime: true }),
    [drafts],
  );
  const issues = serverIssues ?? check.issues;
  const issuesFor = (i: number) => issues.filter((x) => x.index === i);
  const general = issues.filter((x) => x.index === null);
  const unconfirmed = drafts.filter((d) => !d.confirmed).length;

  const update = (key: string, patch: Partial<AvailabilityDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <section aria-labelledby="availability-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="availability-heading" className="text-lg font-semibold text-brand-navy">
            Your weekly times
          </h2>
          <p className="text-sm text-muted-foreground">
            Sessions are only placed in <strong>free</strong> time. Busy time always wins. Times you do not list are
            never assumed to be free.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onChange([...drafts, blankDraft("free")])}>
            <Plus aria-hidden /> Free time
          </Button>
          <Button variant="outline" size="sm" onClick={() => onChange([...drafts, blankDraft("busy")])}>
            <Plus aria-hidden /> Busy time
          </Button>
          <FillGapsDialog drafts={drafts} onAdd={(rows) => onChange([...drafts, ...rows])} />
        </div>
      </div>

      {drafts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input bg-card p-6 text-center text-sm text-muted-foreground">
          No times yet. Upload a timetable above, or add the times you are free to train.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Weekly times">
          {drafts.map((d, i) => (
            <AvailabilityRow
              key={d.key}
              index={i}
              draft={d}
              issues={issuesFor(i)}
              onUpdate={(patch) => update(d.key, patch)}
              onRemove={() => onChange(drafts.filter((x) => x.key !== d.key))}
            />
          ))}
        </ul>
      )}

      {general.length > 0 && (
        <ul className="space-y-1 text-sm text-destructive" role="alert">
          {general.map((g) => (
            <li key={g.code} className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {g.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {check.ok
            ? "Everything checks out. Save to use these times for planning."
            : unconfirmed > 0
              ? `${unconfirmed} row${unconfirmed === 1 ? "" : "s"} still need${unconfirmed === 1 ? "s" : ""} checking.`
              : "Fix the highlighted rows to continue."}
        </p>
        <Button onClick={onSave} disabled={saving || drafts.length === 0 || !check.ok}>
          {saving ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </section>
  );
}

function AvailabilityRow({
  index,
  draft: d,
  issues,
  onUpdate,
  onRemove,
}: {
  index: number;
  draft: AvailabilityDraft;
  issues: AvailabilityIssue[];
  onUpdate: (patch: Partial<AvailabilityDraft>) => void;
  onRemove: () => void;
}) {
  const id = `row-${d.key}`;
  const errorOn = (field: AvailabilityIssue["field"]) =>
    issues.some((i) => i.field === field && i.severity === "error") || undefined;
  const extracted = d.source !== "manual";
  const needsCheck = extracted || d.label === GAP_LABEL;
  // Editing an extracted row is a correction; the runner still confirms it explicitly.
  const edit = (patch: Partial<AvailabilityDraft>) => onUpdate(patch);

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-3",
        needsCheck && !d.confirmed && "border-dashed border-input",
        issues.some((i) => i.severity === "error") && "border-destructive",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-brand-navy">Row {index + 1}</span>
        {extracted ? (
          <Badge variant="outline">
            <Sparkles aria-hidden />
            {d.source === "ai" ? "Read by AI" : "Read from PDF"}
            {d.confidence !== null && ` · ${Math.round(d.confidence * 100)}% sure`}
          </Badge>
        ) : (
          <Badge variant="secondary">Entered by you</Badge>
        )}
        {!extracted && d.label === GAP_LABEL && <Badge variant="outline">Filled from gaps</Badge>}
        {d.confirmed && needsCheck && (
          <Badge variant="secondary">
            <CircleCheck aria-hidden /> Checked
          </Badge>
        )}
      </div>
      {d.rawText && (
        <p className="mb-2 rounded-md bg-muted px-2 py-1 font-mono text-xs break-words text-muted-foreground">
          Read: “{d.rawText}”
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1.5fr_auto]">
        <div className="space-y-1">
          <Label htmlFor={`${id}-day`} className="text-xs">
            Day
          </Label>
          <NativeSelect
            id={`${id}-day`}
            value={d.weekday ?? ""}
            aria-invalid={errorOn("weekday")}
            onChange={(e) => edit({ weekday: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Choose…</option>
            {WEEKDAY_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-kind`} className="text-xs">
            Type
          </Label>
          <NativeSelect
            id={`${id}-kind`}
            value={d.kind}
            onChange={(e) => edit({ kind: e.target.value as "free" | "busy" })}
          >
            <option value="free">Free</option>
            <option value="busy">Busy</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-start`} className="text-xs">
            Start
          </Label>
          <Input
            id={`${id}-start`}
            type="time"
            value={d.startTime ?? ""}
            aria-invalid={errorOn("startTime")}
            onChange={(e) => edit({ startTime: e.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-end`} className="text-xs">
            End
          </Label>
          <Input
            id={`${id}-end`}
            type="time"
            value={d.endTime ?? ""}
            aria-invalid={errorOn("endTime")}
            onChange={(e) => edit({ endTime: e.target.value || null })}
          />
        </div>
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor={`${id}-label`} className="text-xs">
            Label (optional)
          </Label>
          <Input
            id={`${id}-label`}
            value={d.label ?? ""}
            maxLength={80}
            onChange={(e) => edit({ label: e.target.value || null })}
          />
        </div>
        <div className="col-span-2 flex items-end justify-end sm:col-span-1">
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Delete row ${index + 1}`}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {d.uncertainties.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-brand-navy">
          {d.uncertainties.map((u) => (
            <li key={u} className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-brand-red-strong" aria-hidden /> {u}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {issues.map((issue, i) => (
            <li
              key={`${issue.code}-${i}`}
              className={cn("flex gap-2", issue.severity === "error" ? "text-destructive" : "text-muted-foreground")}
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {issue.message}
            </li>
          ))}
        </ul>
      )}
      {needsCheck && (
        <label className="mt-3 flex min-h-10 items-center gap-2 text-sm font-medium text-brand-navy">
          <input
            type="checkbox"
            className="size-4 accent-brand-navy"
            checked={d.confirmed}
            onChange={(e) => onUpdate({ confirmed: e.target.checked })}
          />
          This row is correct
        </label>
      )}
    </li>
  );
}

function FillGapsDialog({
  drafts,
  onAdd,
}: {
  drafts: AvailabilityDraft[];
  onAdd: (rows: AvailabilityDraft[]) => void;
}) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [from, setFrom] = useState("06:00");
  const [to, setTo] = useState("21:00");
  const [open, setOpen] = useState(false);
  const hasBusy = drafts.some((d) => d.kind === "busy");
  const preview = useMemo(
    () => (from < to ? deriveFreeFromBusy(drafts, { weekdays: days, from, to, makeKey: newKey }) : []),
    [drafts, days, from, to],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasBusy}>
          <Wand2 aria-hidden /> Fill gaps
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Treat gaps between busy times as free?</DialogTitle>
          <DialogDescription>
            Only do this if you really are free in those gaps. The new rows are added for you to check; nothing is saved
            yet.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">On these days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_SHORT.map((name, i) => {
              const day = i + 1;
              const on = days.includes(day);
              return (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant={on ? "secondary" : "outline"}
                  aria-pressed={on}
                  onClick={() => setDays(on ? days.filter((x) => x !== day) : [...days, day])}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="gaps-from">Not before</Label>
            <Input id="gaps-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gaps-to">Not after</Label>
            <Input id="gaps-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preview.length} free period{preview.length === 1 ? "" : "s"} of 20+ minutes will be added.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            disabled={preview.length === 0}
            onClick={() => {
              onAdd(preview);
              setOpen(false);
            }}
          >
            Add {preview.length} rows to check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
