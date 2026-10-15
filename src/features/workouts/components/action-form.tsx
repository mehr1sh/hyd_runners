"use client";

import { useActionState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ActionState } from "../actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** A one-button form for a server action, with pending state and inline errors. */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel = "Please wait…",
  variant = "default",
  size = "default",
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: ReactNode;
  pendingLabel?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ActionState);
  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state.status === "error" && state.message && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
