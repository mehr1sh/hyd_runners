"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveProfileStyle, saveReflection, type StoryState } from "../actions";
import { storySuggestions, type StoryStats } from "../logic";

const idle: StoryState = { status: "idle" };

function Note({ state }: { state: StoryState }) {
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

export function ReflectionForm({
  activityId,
  stats,
  initial,
}: {
  activityId: string;
  stats: StoryStats;
  initial: { difficult: string; enjoyed: string; ranWith: string; achieved: string; story: string; share: boolean };
}) {
  const [state, action, pending] = useActionState(saveReflection, idle);
  const [r, setR] = useState(initial);
  const suggestions = storySuggestions(r, stats);
  const field = (k: "difficult" | "enjoyed" | "ranWith" | "achieved", label: string, max: number) => (
    <div className="space-y-1">
      <Label htmlFor={`rf-${k}`}>{label}</Label>
      <Input
        id={`rf-${k}`}
        name={k}
        maxLength={max}
        value={r[k]}
        onChange={(e) => setR({ ...r, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="activityId" value={activityId} />
      <div className="grid gap-2 sm:grid-cols-2">
        {field("difficult", "What was difficult?", 300)}
        {field("enjoyed", "What did you enjoy?", 300)}
        {field("ranWith", "Who did you run with?", 120)}
        {field("achieved", "What did you achieve?", 300)}
      </div>
      {suggestions.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Suggestions from your answers (tap to use)</p>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="text-left underline-offset-4 hover:underline"
                  onClick={() => setR({ ...r, story: s })}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="rf-story">Your story</Label>
        <Textarea
          id="rf-story"
          name="story"
          maxLength={1500}
          rows={3}
          value={r.story}
          onChange={(e) => setR({ ...r, story: e.target.value })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="share"
          checked={r.share}
          onChange={(e) => setR({ ...r, share: e.target.checked })}
        />
        Show my story to people who can see this activity
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save story
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function ProfileStyleForm({
  theme,
  earned,
  showcase,
  routes,
  favourites,
  showRaces,
}: {
  theme: string;
  earned: { code: string; title: string }[];
  showcase: string[];
  routes: { id: string; name: string }[];
  favourites: string[];
  showRaces: boolean;
}) {
  const [state, action, pending] = useActionState(saveProfileStyle, idle);
  return (
    <form action={action} className="space-y-3">
      <div className="max-w-48 space-y-1">
        <Label htmlFor="ps-theme">Profile theme</Label>
        <select
          id="ps-theme"
          name="theme"
          defaultValue={theme}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="classic">Classic</option>
          <option value="night">Night run</option>
          <option value="sunrise">Sunrise</option>
          <option value="lake">Lake loop</option>
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Badges to showcase (up to six, from badges you&apos;ve earned)</legend>
        {earned.length === 0 ? (
          <p className="text-sm text-muted-foreground">No badges earned yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3 text-sm">
            {earned.map((b) => (
              <label key={b.code} className="flex items-center gap-1">
                <input type="checkbox" name="badges" value={b.code} defaultChecked={showcase.includes(b.code)} />
                {b.title}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Favourite routes (up to five)</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {routes.map((r) => (
            <label key={r.id} className="flex items-center gap-1">
              <input type="checkbox" name="routes" value={r.id} defaultChecked={favourites.includes(r.id)} />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="races" defaultChecked={showRaces} />
        Show my race history and best efforts (from activities I share) on my runner profile
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save showcase
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}
