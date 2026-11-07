"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FitnessGoal, FitnessLevel, TimeOfDay } from "@/lib/contracts";
import { RECOVERY_RULES } from "../logic/programme";
import { WEEKDAY_SHORT } from "../logic/time";
import type { PlannerSettings } from "../logic/types";
import { NativeSelect } from "./native-select";

/** Form state: goal and level start empty so they are always chosen, never assumed. */
export type SettingsDraft = Omit<PlannerSettings, "goal" | "fitnessLevel"> & {
  goal: FitnessGoal | null;
  fitnessLevel: FitnessLevel | null;
};

const GOALS: Array<[FitnessGoal, string]> = [
  ["build_habit", "Build a regular habit"],
  ["first_5k", "Run my first 5K"],
  ["run_without_stopping", "Run without stopping"],
  ["return_after_break", "Come back after a break"],
  ["get_stronger", "Get stronger"],
];

const LEVELS: Array<[FitnessLevel, string]> = [
  ["new_to_running", "New to running"],
  ["returning", "Returning after a break"],
  ["regular", "Already run regularly"],
];

const TIMES: Array<[TimeOfDay, string]> = [
  ["early_morning", "Early morning (5–7)"],
  ["morning", "Morning (7–12)"],
  ["afternoon", "Afternoon (12–4)"],
  ["evening", "Evening (4–8)"],
  ["night", "Night (after 8)"],
];

export function toSettings(d: SettingsDraft): PlannerSettings | null {
  if (!d.goal || !d.fitnessLevel) return null;
  if (!Number.isInteger(d.sessionsPerWeek) || d.sessionsPerWeek < 1 || d.sessionsPerWeek > 7) return null;
  if (!Number.isInteger(d.maxSessionMinutes) || d.maxSessionMinutes < 10 || d.maxSessionMinutes > 180) return null;
  if (!Number.isInteger(d.programmeWeek) || d.programmeWeek < 1 || d.programmeWeek > 52) return null;
  return { ...d, goal: d.goal, fitnessLevel: d.fitnessLevel };
}

function toggle<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function PlannerSettingsForm({
  value,
  onChange,
}: {
  value: SettingsDraft;
  onChange: (v: SettingsDraft) => void;
}) {
  const cap = value.fitnessLevel ? RECOVERY_RULES[value.fitnessLevel].maxSessionsPerWeek : null;
  return (
    <section aria-labelledby="settings-heading" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 id="settings-heading" className="text-lg font-semibold text-brand-navy">
        What should the week look like?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="goal">Goal</Label>
          <NativeSelect
            id="goal"
            required
            value={value.goal ?? ""}
            aria-invalid={!value.goal || undefined}
            onChange={(e) => onChange({ ...value, goal: (e.target.value || null) as FitnessGoal | null })}
          >
            <option value="">Choose your goal…</option>
            {GOALS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="level">Experience</Label>
          <NativeSelect
            id="level"
            required
            value={value.fitnessLevel ?? ""}
            aria-invalid={!value.fitnessLevel || undefined}
            onChange={(e) => onChange({ ...value, fitnessLevel: (e.target.value || null) as FitnessLevel | null })}
          >
            <option value="">Choose your experience…</option>
            {LEVELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sessions">Sessions per week</Label>
          <Input
            id="sessions"
            type="number"
            inputMode="numeric"
            min={1}
            max={7}
            value={Number.isNaN(value.sessionsPerWeek) ? "" : value.sessionsPerWeek}
            onChange={(e) => onChange({ ...value, sessionsPerWeek: e.target.valueAsNumber })}
          />
          {cap !== null && value.sessionsPerWeek > cap && (
            <p className="text-xs text-muted-foreground">
              For your experience the plan keeps at most {cap} sessions, to leave recovery days.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-minutes">Longest session (minutes)</Label>
          <Input
            id="max-minutes"
            type="number"
            inputMode="numeric"
            min={10}
            max={180}
            step={5}
            value={Number.isNaN(value.maxSessionMinutes) ? "" : value.maxSessionMinutes}
            onChange={(e) => onChange({ ...value, maxSessionMinutes: e.target.valueAsNumber })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="programme-week">Programme week</Label>
          <Input
            id="programme-week"
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            value={Number.isNaN(value.programmeWeek) ? "" : value.programmeWeek}
            onChange={(e) => onChange({ ...value, programmeWeek: e.target.valueAsNumber })}
          />
          <p className="text-xs text-muted-foreground">Week 1 if you are just starting. Sessions build up gradually.</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-brand-navy">Preferred days (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_SHORT.map((name, i) => {
            const on = value.preferredDays.includes(i + 1);
            return (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={on ? "secondary" : "outline"}
                aria-pressed={on}
                onClick={() => onChange({ ...value, preferredDays: toggle(value.preferredDays, i + 1).sort() })}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-brand-navy">Preferred time of day (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {TIMES.map(([v, l]) => {
            const on = value.preferredTimesOfDay.includes(v);
            return (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={on ? "secondary" : "outline"}
                aria-pressed={on}
                onClick={() => onChange({ ...value, preferredTimesOfDay: toggle(value.preferredTimesOfDay, v) })}
              >
                {l}
              </Button>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
