"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveExperienceAction, savePlacesAction, saveTrainingAction, type FormState } from "../actions";
import {
  ACTIVITY_LABEL,
  FITNESS_LEVEL_LABEL,
  GOAL_LABEL,
  TIME_OF_DAY_LABEL,
  WEEKDAY_LABEL,
  difficultiesFromPrimaryNeed,
  type PreferredActivity,
} from "../logic/onboarding";
import type { OnboardingRecord } from "../service";

const idle: FormState = { status: "idle" };
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Choice({
  name,
  value,
  label,
  defaultChecked,
  type = "checkbox",
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
  type?: "checkbox" | "radio";
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-lg border bg-card px-3 text-sm text-brand-navy">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 accent-[#C8161D]"
      />
      {label}
    </label>
  );
}

function ErrorNote({ state }: { state: FormState }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function OnboardingWizard({
  record,
  locations,
}: {
  record: OnboardingRecord;
  locations: { id: string; name: string; verified: boolean }[];
}) {
  const initial = record.onboardedAt ? 4 : record.fitnessLevel ? (record.preferences ? 3 : 2) : 1;
  const [step, setStep] = useState(initial);
  const difficulties = difficultiesFromPrimaryNeed(record.primaryNeed);

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-3 gap-2 text-xs text-muted-foreground sm:text-sm">
        {["Experience", "Training", "Places"].map((label, index) => (
          <li
            key={label}
            className={step === index + 1 ? "font-semibold text-brand-navy" : undefined}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <ExperienceStep
          record={record}
          consistency={difficulties.consistency}
          schedule={difficulties.schedule}
          onSaved={() => setStep(2)}
        />
      )}
      {step === 2 && <TrainingStep record={record} onSaved={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <PlacesStep record={record} locations={locations} onBack={() => setStep(2)} />}
      {step === 4 && (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <p className="text-sm text-brand-navy">Your setup is saved. You can change it any time.</p>
          <Button type="button" variant="outline" onClick={() => setStep(1)}>
            Edit answers
          </Button>
        </div>
      )}
    </div>
  );
}

function ExperienceStep({
  record,
  consistency,
  schedule,
  onSaved,
}: {
  record: OnboardingRecord;
  consistency: boolean;
  schedule: boolean;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(saveExperienceAction, idle);
  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state.status, onSaved]);
  return (
    <form action={action} className="space-y-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="displayName">What should we call you?</FieldLabel>
          <Input id="displayName" name="displayName" required maxLength={60} defaultValue={record.displayName} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Running experience</legend>
          {(Object.keys(FITNESS_LEVEL_LABEL) as (keyof typeof FITNESS_LEVEL_LABEL)[]).map((level) => (
            <Choice
              key={level}
              type="radio"
              name="fitnessLevel"
              value={level}
              label={FITNESS_LEVEL_LABEL[level]}
              defaultChecked={record.fitnessLevel === level}
            />
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">What gets in the way?</legend>
          <p className="text-xs text-muted-foreground">You can select both.</p>
          <Choice name="consistency" value="yes" label="I struggle to stay consistent" defaultChecked={consistency} />
          <Choice name="scheduleConflicts" value="yes" label="My timetable keeps changing" defaultChecked={schedule} />
        </fieldset>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Input id="timezone" name="timezone" defaultValue={record.timezone || "Asia/Kolkata"} required />
        </Field>
      </FieldGroup>
      <ErrorNote state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}

function TrainingStep({
  record,
  onSaved,
  onBack,
}: {
  record: OnboardingRecord;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(saveTrainingAction, idle);
  const prefs = record.preferences;
  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state.status, onSaved]);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="timezone" value={record.timezone || "Asia/Kolkata"} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="goal">Fitness goal</FieldLabel>
          <select id="goal" name="goal" required defaultValue={prefs?.goal ?? ""} className={selectClass}>
            <option value="" disabled>
              Choose a goal
            </option>
            {(Object.keys(GOAL_LABEL) as (keyof typeof GOAL_LABEL)[]).map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABEL[goal]}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Preferred activities</legend>
          {(Object.keys(ACTIVITY_LABEL) as PreferredActivity[]).map((activity) => (
            <Choice
              key={activity}
              name="preferredActivities"
              value={activity}
              label={ACTIVITY_LABEL[activity]}
              defaultChecked={prefs?.preferredActivities.includes(activity)}
            />
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Days you can train</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(WEEKDAY_LABEL).map(([day, label]) => (
              <Choice
                key={day}
                name="preferredDays"
                value={day}
                label={label}
                defaultChecked={prefs?.preferredDays.includes(Number(day))}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Preferred time of day</legend>
          {(Object.keys(TIME_OF_DAY_LABEL) as (keyof typeof TIME_OF_DAY_LABEL)[]).map((time) => (
            <Choice
              key={time}
              name="preferredTimesOfDay"
              value={time}
              label={TIME_OF_DAY_LABEL[time]}
              defaultChecked={prefs?.preferredTimesOfDay.includes(time)}
            />
          ))}
        </fieldset>
        <Field>
          <FieldLabel htmlFor="sessionsPerWeek">Sessions per week</FieldLabel>
          <Input
            id="sessionsPerWeek"
            name="sessionsPerWeek"
            type="number"
            min={1}
            max={7}
            required
            defaultValue={prefs?.sessionsPerWeek ?? 3}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="maxSessionMinutes">Typical session length (minutes)</FieldLabel>
          <Input
            id="maxSessionMinutes"
            name="maxSessionMinutes"
            type="number"
            min={10}
            max={180}
            required
            defaultValue={prefs?.maxSessionMinutes ?? 30}
          />
        </Field>
      </FieldGroup>
      <ErrorNote state={state} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}

function PlacesStep({
  record,
  locations,
  onBack,
}: {
  record: OnboardingRecord;
  locations: { id: string; name: string; verified: boolean }[];
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(savePlacesAction, idle);
  const selected = new Set(record.preferences?.preferredLocationIds ?? []);
  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-brand-navy">Preferred locations</legend>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No locations have been published yet. You can finish and choose later.
          </p>
        ) : (
          locations.map((location) => (
            <Choice
              key={location.id}
              name="preferredLocationIds"
              value={location.id}
              label={location.verified ? location.name : `${location.name} (unverified)`}
              defaultChecked={selected.has(location.id)}
            />
          ))
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-brand-navy">Notification preferences</legend>
        <p className="text-xs text-muted-foreground">These are saved on your profile. Email and push are not sent.</p>
        <Choice
          name="remindersEnabled"
          value="yes"
          label="Remind me about planned sessions in the app"
          defaultChecked={record.preferences?.remindersEnabled}
        />
        <Choice
          name="notifyInApp"
          value="yes"
          label="Show announcements and feedback replies in the app"
          defaultChecked={record.preferences?.notifyInApp ?? true}
        />
      </fieldset>
      <ErrorNote state={state} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Finish setup"}
        </Button>
      </div>
    </form>
  );
}
