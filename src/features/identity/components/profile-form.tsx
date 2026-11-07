"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveProfileAction, type FormState } from "../actions";
import { FITNESS_LEVEL_LABEL, NEED_LABEL, difficultiesFromPrimaryNeed } from "../logic/onboarding";
import type { OnboardingRecord } from "../service";

const idle: FormState = { status: "idle" };

export function ProfileForm({ record }: { record: OnboardingRecord }) {
  const [state, action, pending] = useActionState(saveProfileAction, idle);
  const difficulties = difficultiesFromPrimaryNeed(record.primaryNeed);

  return (
    <form action={action} className="space-y-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input id="profile-name" name="displayName" required maxLength={60} defaultValue={record.displayName} />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-timezone">Timezone</FieldLabel>
          <Input id="profile-timezone" name="timezone" required defaultValue={record.timezone} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Running experience</legend>
          {(Object.entries(FITNESS_LEVEL_LABEL) as [keyof typeof FITNESS_LEVEL_LABEL, string][]).map(
            ([level, label]) => (
              <label key={level} className="flex min-h-10 items-center gap-3 text-sm text-brand-navy">
                <input
                  type="radio"
                  name="fitnessLevel"
                  value={level}
                  defaultChecked={record.fitnessLevel === level}
                  className="size-4 accent-[#C8161D]"
                  required
                />
                {label}
              </label>
            ),
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">Difficulties</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="consistency"
              value="yes"
              defaultChecked={difficulties.consistency}
              className="size-4 accent-[#C8161D]"
            />
            Consistency
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="scheduleConflicts"
              value="yes"
              defaultChecked={difficulties.schedule}
              className="size-4 accent-[#C8161D]"
            />
            Scheduling
          </label>
        </fieldset>
      </FieldGroup>
      {record.preferences ? (
        <p className="text-sm text-muted-foreground">
          Goal: <span className="font-medium text-brand-navy">{record.preferences.goal.replaceAll("_", " ")}</span>.
          Sessions: {record.preferences.sessionsPerWeek} per week, up to {record.preferences.maxSessionMinutes} minutes.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Training preferences are saved during setup.</p>
      )}
      {record.primaryNeed && <p className="text-sm text-brand-navy">Current focus: {NEED_LABEL[record.primaryNeed]}</p>}
      {state.status === "error" && state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.status === "success" && state.message && (
        <Alert role="status">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/onboarding">Edit full setup</Link>
        </Button>
      </div>
    </form>
  );
}
