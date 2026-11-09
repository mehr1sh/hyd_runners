"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { askCoach, type CoachState } from "../actions";

const idle: CoachState = { status: "idle" };

export function AskForm({ conversationId }: { conversationId?: string }) {
  const [state, action, pending] = useActionState(askCoach, idle);
  return (
    <form action={action} className="space-y-2" aria-busy={pending}>
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
      <Label htmlFor="coach-question">Ask HYD Coach</Label>
      <Textarea
        id="coach-question"
        name="question"
        required
        minLength={3}
        maxLength={500}
        rows={2}
        placeholder="For example: am I getting faster?"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Looking at your data…" : "Ask"}
        </Button>
        {state.message && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** A suggested question, sent with one click. */
export function SuggestedQuestion({ question, conversationId }: { question: string; conversationId?: string }) {
  const [state, action, pending] = useActionState(askCoach, idle);
  return (
    <form action={action}>
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
      <input type="hidden" name="question" value={question} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="h-auto text-left whitespace-normal"
      >
        {pending ? "Looking…" : question}
      </Button>
      {state.message && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
