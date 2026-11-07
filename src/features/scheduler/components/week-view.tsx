"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, Pencil, RotateCcw, Trash2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlannedWorkoutStatus, WorkoutType } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { formatRange, toMinutes, WEEKDAY_NAMES, weekdayName } from "../logic/time";
import type { ProposedSession, ScheduleViolation } from "../logic/types";
import { NativeSelect } from "./native-select";
import { SESSION_TYPES, WORKOUT_STYLE } from "./workout-style";

export type WeekViewSession = ProposedSession & { status?: PlannedWorkoutStatus; id?: string };

const STATUS_LABEL: Record<PlannedWorkoutStatus, string> = {
  planned: "Planned",
  completed: "Done",
  missed: "Missed",
  rescheduled: "Moved",
  skipped: "Skipped",
};

/** Seven days, Monday first: one column on phones, 2–4 on tablets and laptops, 7 on very wide screens. */
export function WeekView({
  sessions,
  dates,
  mode,
  onEdit,
  onRemove,
  onReschedule,
  busyKey,
}: {
  sessions: WeekViewSession[];
  /** Calendar date label per weekday, e.g. "19 Oct". */
  dates: string[];
  mode: "proposal" | "approved";
  onEdit?: (session: WeekViewSession) => void;
  onRemove?: (session: WeekViewSession) => void;
  onReschedule?: (session: WeekViewSession) => void;
  busyKey?: string | null;
}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" aria-label="Days of the week">
      {WEEKDAY_NAMES.map((name, i) => {
        const weekday = i + 1;
        const today = sessions
          .filter((s) => s.weekday === weekday)
          .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
        const active = today.filter((s) => s.status !== "rescheduled");
        return (
          <li key={name} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3">
            <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-brand-navy">
              {name}
              <span className="text-xs font-normal text-muted-foreground">{dates[i]}</span>
            </h3>
            {active.length === 0 && today.length === 0 && <RestCard />}
            {today.map((s) => (
              <SessionCard
                key={s.key}
                session={s}
                mode={mode}
                onEdit={onEdit}
                onRemove={onRemove}
                onReschedule={onReschedule}
                busy={busyKey === s.key}
              />
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function RestCard() {
  const style = WORKOUT_STYLE.rest;
  return (
    <div
      className={cn("flex items-center gap-2 rounded-lg border border-l-4 border-dashed p-2 text-sm", style.className)}
    >
      <style.icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Rest day</span>
    </div>
  );
}

function SessionCard({
  session: s,
  mode,
  onEdit,
  onRemove,
  onReschedule,
  busy,
}: {
  session: WeekViewSession;
  mode: "proposal" | "approved";
  onEdit?: (s: WeekViewSession) => void;
  onRemove?: (s: WeekViewSession) => void;
  onReschedule?: (s: WeekViewSession) => void;
  busy: boolean;
}) {
  const style = WORKOUT_STYLE[s.workoutType];
  const start = toMinutes(s.startTime);
  const [open, setOpen] = useState(false);
  const moved = s.status === "rescheduled";
  return (
    <article
      className={cn("space-y-1 rounded-lg border border-l-4 p-2 text-sm", style.className, moved && "opacity-60")}
      aria-label={`${style.label}, ${weekdayName(s.weekday)} ${s.startTime}, ${s.durationMinutes} minutes`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <style.icon className="size-4 text-brand-navy" aria-hidden />
        <span className="text-xs font-semibold tracking-wide text-brand-navy uppercase">{style.label}</span>
        {mode === "approved" && s.status && (
          <Badge variant={s.status === "missed" ? "destructive" : "outline"}>{STATUS_LABEL[s.status]}</Badge>
        )}
        {mode === "proposal" && s.plannedBy === "runner" && <Badge variant="outline">Edited</Badge>}
      </div>
      <p className={cn("font-medium break-words text-brand-navy", moved && "line-through")}>{s.title}</p>
      <p className="text-muted-foreground tabular-nums">
        {formatRange(start, Math.min(start + s.durationMinutes, 24 * 60 - 1))} · {s.durationMinutes} min
      </p>
      {s.rationale.length > 0 && (
        <div>
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-brand-navy underline-offset-2 hover:underline"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Why this time?{" "}
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {s.rationale.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        {mode === "proposal" && onEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(s)}
            aria-label={`Edit ${s.title} on ${weekdayName(s.weekday)}`}
          >
            <Pencil aria-hidden /> Edit
          </Button>
        )}
        {mode === "proposal" && onRemove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(s)}
            aria-label={`Remove ${s.title} on ${weekdayName(s.weekday)}`}
          >
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
        {mode === "approved" && onReschedule && (s.status === "planned" || s.status === "missed") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onReschedule(s)}>
            <RotateCcw aria-hidden /> {busy ? "Finding a slot…" : "Missed it? Reschedule"}
          </Button>
        )}
      </div>
    </article>
  );
}

export type SessionDraft = Pick<ProposedSession, "weekday" | "startTime" | "durationMinutes" | "workoutType" | "title">;

/**
 * Edit or add one session. The parent applies the change with full
 * revalidation; if it is rejected, the dialog stays open with the reasons and
 * the week keeps its last valid state.
 */
export function SessionDialog({
  open,
  title,
  initial,
  maxMinutes,
  violations,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  initial: SessionDraft;
  maxMinutes: number;
  violations: ScheduleViolation[];
  onSubmit: (draft: SessionDraft) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setDraft(initial);
  }
  const durationValid =
    Number.isInteger(draft.durationMinutes) && draft.durationMinutes >= 10 && draft.durationMinutes <= maxMinutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Changes are checked against your free time, your {maxMinutes}-minute limit and your recovery days.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (durationValid && draft.startTime) onSubmit(draft);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="session-day">Day</Label>
              <NativeSelect
                id="session-day"
                value={draft.weekday}
                onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
              >
                {WEEKDAY_NAMES.map((n, i) => (
                  <option key={n} value={i + 1}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="session-start">Start</Label>
              <Input
                id="session-start"
                type="time"
                step={300}
                required
                value={draft.startTime}
                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="session-duration">Minutes</Label>
              <Input
                id="session-duration"
                type="number"
                inputMode="numeric"
                min={10}
                max={maxMinutes}
                step={5}
                aria-invalid={!durationValid || undefined}
                value={Number.isNaN(draft.durationMinutes) ? "" : draft.durationMinutes}
                onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.valueAsNumber })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="session-type">Type</Label>
              <NativeSelect
                id="session-type"
                value={draft.workoutType}
                onChange={(e) => setDraft({ ...draft, workoutType: e.target.value as Exclude<WorkoutType, "rest"> })}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WORKOUT_STYLE[t].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="session-title">Title</Label>
            <Input
              id="session-title"
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          {!durationValid && <p className="text-sm text-destructive">Choose between 10 and {maxMinutes} minutes.</p>}
          {violations.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-lg border border-destructive p-3 text-sm text-destructive">
              <li className="font-medium">This change was not applied:</li>
              {violations.map((v, i) => (
                <li key={`${v.code}-${i}`} className="flex gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {v.message}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!durationValid || !draft.title.trim()}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
