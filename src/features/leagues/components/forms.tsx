"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addTeam, createLeague, joinTeam, updateLeague, type LeagueState } from "../actions";
import { LEAGUE_KINDS, SCORING_LABEL, type ScoringKey } from "../logic";

const idle: LeagueState = { status: "idle" };
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Note({ state }: { state: LeagueState }) {
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

export function CreateLeagueForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createLeague, idle);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="lg-name">League name</Label>
        <Input id="lg-name" name="name" required maxLength={80} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lg-kind">Type</Label>
        <select id="lg-kind" name="kind" className={selectClass} defaultValue="city">
          {Object.entries(LEAGUE_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="lg-start">Starts</Label>
          <Input id="lg-start" name="startsOn" type="date" required defaultValue={today} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lg-end">Ends</Label>
          <Input id="lg-end" name="endsOn" type="date" required />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lg-desc">Description (optional)</Label>
        <Textarea id="lg-desc" name="description" maxLength={1000} rows={2} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Create league
        </Button>
        <Note state={state} />
      </div>
      <p className="text-xs text-muted-foreground">
        Leagues start as drafts. Add teams and check the scoring, then open it.
      </p>
    </form>
  );
}

export function LeagueAdminForm({
  leagueId,
  scoring,
  status,
}: {
  leagueId: string;
  scoring: Record<ScoringKey, number>;
  status: string;
}) {
  const [state, action, pending] = useActionState(updateLeague, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leagueId" value={leagueId} />
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Scoring (points, 0–100)</legend>
        {(Object.keys(SCORING_LABEL) as ScoringKey[]).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Input
              name={`w_${k}`}
              type="number"
              min={0}
              max={100}
              defaultValue={scoring[k] ?? 0}
              className="w-20"
              aria-label={`Points ${SCORING_LABEL[k]}`}
            />
            <span>{SCORING_LABEL[k]}</span>
          </label>
        ))}
      </fieldset>
      <div className="max-w-48 space-y-1">
        <Label htmlFor="lg-status">Status</Label>
        <select id="lg-status" name="status" className={selectClass} defaultValue={status}>
          <option value="draft">Draft (only admins see it)</option>
          <option value="active">Open</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save league
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function AddTeamForm({ leagueId, clubs }: { leagueId: string; clubs: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addTeam, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="leagueId" value={leagueId} />
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="tm-name">Team name</Label>
        <Input id="tm-name" name="name" required maxLength={60} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tm-aff">Team type</Label>
        <select id="tm-aff" name="affiliation" className={selectClass} defaultValue="custom">
          <option value="custom">Open team (join code)</option>
          <option value="university">University (join code)</option>
          <option value="corporate">Company (join code)</option>
          <option value="club">Club (club members)</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="tm-club">Club (for club teams)</Label>
        <select id="tm-club" name="clubId" className={selectClass} defaultValue="">
          <option value="">—</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          Add team
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function JoinTeamForm({
  leagueId,
  teamId,
  needsCode,
  label,
}: {
  leagueId: string;
  teamId: string;
  needsCode: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState(joinTeam, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="teamId" value={teamId} />
      {needsCode && (
        <Input
          name="code"
          placeholder="Join code"
          aria-label={`Join code for ${label}`}
          className="w-32"
          maxLength={20}
        />
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Join {label}
      </Button>
      <Note state={state} />
    </form>
  );
}
