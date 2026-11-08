"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, type ForgotPasswordState } from "../actions";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm({ notice }: { notice?: string | null }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Move focus to the confirmation so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (state.status === "sent") confirmationRef.current?.focus();
  }, [state.status]);

  if (state.status === "sent") {
    return (
      <div className="space-y-6">
        <Alert role="status" ref={confirmationRef} tabIndex={-1} className="outline-none">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/sign-in" className="font-medium text-brand-red-strong underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {notice && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
      </FieldGroup>

      {state.status === "error" && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Please wait…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-brand-red-strong underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
