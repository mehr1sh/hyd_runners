"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { socialAction, type SocialState } from "../actions";

const idle: SocialState = { status: "idle" };
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

function Note({ state }: { state: SocialState }) {
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

/** A one-click social action (follow, accept, block, kudos, …). */
export function SocialButton({
  intent,
  fields,
  label,
  variant = "outline",
  confirm,
}: {
  intent: string;
  fields: Record<string, string>;
  label: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  confirm?: string;
}) {
  const [state, action, pending] = useActionState(socialAction, idle);
  return (
    <form
      action={action}
      className="inline-flex flex-col gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? "…" : label}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function CommentForm({ activityId }: { activityId: string }) {
  const [state, action, pending] = useActionState(socialAction, idle);
  return (
    <form action={action} className="space-y-2" key={state.status === "success" ? state.message : "form"}>
      <input type="hidden" name="intent" value="comment" />
      <input type="hidden" name="activityId" value={activityId} />
      <Label htmlFor="comment-body">Add a comment</Label>
      <Textarea id="comment-body" name="body" maxLength={500} rows={2} required />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Posting…" : "Post comment"}
      </Button>
      <Note state={state} />
    </form>
  );
}

export function ReportForm({
  targetType,
  targetId,
  activityId,
  label,
}: {
  targetType: "activity" | "activity_comment";
  targetId: string;
  activityId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(socialAction, idle);
  const id = `report-${targetId}`;
  if (state.status === "success") return <Note state={state} />;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground underline underline-offset-2">{label}</summary>
      <form action={action} className="mt-2 grid max-w-sm gap-2">
        <input type="hidden" name="intent" value="report" />
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="activityId" value={activityId} />
        <Label htmlFor={`${id}-reason`}>Reason</Label>
        <select id={`${id}-reason`} name="reason" className={selectClass} defaultValue="inappropriate">
          <option value="harassment">Harassment</option>
          <option value="spam">Spam</option>
          <option value="inappropriate">Inappropriate</option>
          <option value="safety">Safety concern</option>
          <option value="other">Other</option>
        </select>
        <Label htmlFor={`${id}-details`}>Details (optional)</Label>
        <Textarea id={`${id}-details`} name="details" maxLength={1000} rows={2} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Send report
        </Button>
        <Note state={state} />
      </form>
    </details>
  );
}

export function SocialSettingsForm({
  bio,
  approveFollowers,
  discoverable,
}: {
  bio: string;
  approveFollowers: boolean;
  discoverable: boolean;
}) {
  const [state, action, pending] = useActionState(socialAction, idle);
  return (
    <form action={action} className="grid max-w-md gap-3">
      <input type="hidden" name="intent" value="settings" />
      <div className="grid gap-1">
        <Label htmlFor="social-bio">Bio (shown on your runner profile)</Label>
        <Input id="social-bio" name="bio" maxLength={160} defaultValue={bio} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="approveFollowers" defaultChecked={approveFollowers} />
        Approve new followers before they see followers-only activities
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="discoverable" defaultChecked={discoverable} />
        Let other runners find me in search
      </label>
      <Button type="submit" size="sm" disabled={pending} className="justify-self-start">
        Save settings
      </Button>
      <Note state={state} />
    </form>
  );
}
