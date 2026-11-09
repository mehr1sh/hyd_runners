"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addCoachNote,
  proposeForRunner,
  replyToNote,
  requestVerification,
  reviewProfessional,
  saveProfessionalProfile,
  type CoachState,
} from "../actions";
import type { ProfessionalProfile } from "../queries";

const idle: CoachState = { status: "idle" };
const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function Note({ state }: { state: CoachState }) {
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

export function CoachNoteForm({
  runnerId,
  activities,
}: {
  runnerId: string;
  activities: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(addCoachNote, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="runnerId" value={runnerId} />
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1">
          <Label htmlFor="note-kind">Type</Label>
          <select id="note-kind" name="kind" className={selectClass} defaultValue="progress_note">
            <option value="workout_feedback">Workout feedback</option>
            <option value="progress_note">Progress note</option>
            <option value="recommendation">Recommendation</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="note-activity">About an activity (optional)</Label>
          <select id="note-activity" name="activityId" className={selectClass} defaultValue="">
            <option value="">None</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Label htmlFor="note-body">Message to your runner</Label>
      <Textarea id="note-body" name="body" required maxLength={2000} rows={3} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function ReplyForm({ noteId, label = "Reply" }: { noteId: string; label?: string }) {
  const [state, action, pending] = useActionState(replyToNote, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="noteId" value={noteId} />
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor={`reply-${noteId}`} className="sr-only">
          {label}
        </Label>
        <Input id={`reply-${noteId}`} name="body" required maxLength={1000} placeholder="Write a reply" />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {label}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function CoachProposalForm({
  runnerId,
  sessions,
}: {
  runnerId: string;
  sessions: { id: string; label: string; minutes: number }[];
}) {
  const [state, action, pending] = useActionState(proposeForRunner, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="runnerId" value={runnerId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cp-title">Title</Label>
          <Input id="cp-title" name="title" required maxLength={120} placeholder="Lighter week before your race" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-reason">Why</Label>
          <Input id="cp-reason" name="reason" required maxLength={500} />
        </div>
      </div>
      {sessions.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Upcoming sessions</legend>
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-48">{s.label}</span>
                <label className="flex items-center gap-1">
                  Shorten to
                  <select name="shorten" className={selectClass} defaultValue="" aria-label={`Shorten ${s.label}`}>
                    <option value="">keep</option>
                    {[0.5, 0.67, 0.75, 0.85]
                      .map((f) => Math.max(5, Math.round((s.minutes * f) / 5) * 5))
                      .filter((m, i, a) => m < s.minutes && a.indexOf(m) === i)
                      .map((m) => (
                        <option key={m} value={`${s.id}:${m}`}>
                          {m} min
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" name="cancel" value={s.id} /> remove
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="grid gap-2 sm:grid-cols-5">
        <legend className="text-sm font-medium">Add a session (optional)</legend>
        <Input
          name="addTitle"
          placeholder="Title"
          aria-label="New session title"
          maxLength={120}
          className="sm:col-span-2"
        />
        <select name="addType" className={selectClass} aria-label="New session type" defaultValue="run">
          <option value="run">Run</option>
          <option value="walk_run">Walk-run</option>
          <option value="strength">Strength</option>
          <option value="mobility">Mobility</option>
          <option value="cross_training">Cross-training</option>
        </select>
        <Input name="addDate" type="date" aria-label="New session date" />
        <div className="flex gap-1">
          <Input name="addTime" type="time" defaultValue="06:30" aria-label="New session time" />
          <Input
            name="addMinutes"
            type="number"
            min={5}
            max={300}
            defaultValue={30}
            aria-label="New session minutes"
            className="w-20"
          />
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Propose to runner"}
        </Button>
        <Note state={state} />
      </div>
      <p className="text-xs text-muted-foreground">
        Your runner reviews every change. Nothing in their plan changes until they accept.
      </p>
    </form>
  );
}

const PROFESSIONS = {
  running_coach: "Running coach",
  strength_coach: "Strength coach",
  physiotherapist: "Physiotherapist",
  nutritionist: "Nutritionist",
  run_captain: "Run captain",
} as const;

export function ProfessionalProfileForm({ profile }: { profile: ProfessionalProfile | null }) {
  const [state, action, pending] = useActionState(saveProfessionalProfile, idle);
  type Cred = ProfessionalProfile["credentials"][number];
  const blank: Cred = { name: "" };
  const creds: Cred[] = [...(profile?.credentials ?? []), blank, blank, blank].slice(
    0,
    Math.max(3, (profile?.credentials.length ?? 0) + 1),
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pp-profession">Profession</Label>
          <select
            id="pp-profession"
            name="profession"
            className={`${selectClass} w-full`}
            defaultValue={profile?.profession ?? "running_coach"}
          >
            {Object.entries(PROFESSIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-exp">Years of experience</Label>
          <Input
            id="pp-exp"
            name="experienceYears"
            type="number"
            min={0}
            max={60}
            defaultValue={profile?.experienceYears ?? ""}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pp-headline">Headline</Label>
        <Input id="pp-headline" name="headline" maxLength={120} defaultValue={profile?.headline ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pp-bio">About you</Label>
        <Textarea id="pp-bio" name="bio" maxLength={2000} rows={4} defaultValue={profile?.bio ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pp-spec">Specialisations (comma-separated)</Label>
        <Input
          id="pp-spec"
          name="specializations"
          maxLength={400}
          defaultValue={profile?.specializations.join(", ") ?? ""}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Credentials</legend>
        {creds.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-4">
            <Input
              name="credName"
              defaultValue={c.name}
              placeholder="Qualification"
              aria-label={`Credential ${i + 1} name`}
            />
            <Input
              name="credIssuer"
              defaultValue={c.issuer ?? ""}
              placeholder="Issued by"
              aria-label={`Credential ${i + 1} issuer`}
            />
            <Input
              name="credYear"
              defaultValue={c.year ?? ""}
              placeholder="Year"
              inputMode="numeric"
              aria-label={`Credential ${i + 1} year`}
            />
            <Input
              name="credRef"
              defaultValue={c.reference ?? ""}
              placeholder="Licence or reference no."
              aria-label={`Credential ${i + 1} reference`}
            />
          </div>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="listed" defaultChecked={profile?.listed ?? false} />
        Show my profile to runners
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function RequestVerificationButton() {
  const [state, action, pending] = useActionState(requestVerification, idle);
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" variant="outline" disabled={pending}>
        Request verification
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ReviewForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(reviewProfessional, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1">
        <Label htmlFor={`rv-${userId}`}>Decision</Label>
        <select id={`rv-${userId}`} name="status" className={selectClass} defaultValue="verified">
          <option value="verified">Verify</option>
          <option value="rejected">Reject</option>
          <option value="suspended">Suspend</option>
          <option value="unverified">Reset to unverified</option>
        </select>
      </div>
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor={`rn-${userId}`}>How you checked (kept in the audit log)</Label>
        <Input id={`rn-${userId}`} name="note" maxLength={500} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Save decision
      </Button>
      <Note state={state} />
    </form>
  );
}
