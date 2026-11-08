"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resetPassword, type ResetPasswordState } from "../actions";
import { FORGOT_PASSWORD_PATH } from "../logic/password-reset";

const initialState: ResetPasswordState = { status: "idle" };

const linkClass = "font-medium text-brand-red-strong underline-offset-4 hover:underline";

/** Shown on the reset page when no session came from a reset link. */
export function ResetPasswordSessionMissing({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <Alert role="status">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button asChild className="w-full" size="lg">
        <Link href={FORGOT_PASSWORD_PATH}>Request a new link</Link>
      </Button>
    </div>
  );
}

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {/* Lets password managers attach the new password to the right account. */}
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="password-hint"
          />
          <FieldDescription id="password-hint">At least 8 characters.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
      </FieldGroup>

      {state.status === "error" && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {state.message}
            {state.sessionMissing && (
              <>
                {" "}
                <Link href={FORGOT_PASSWORD_PATH} className={linkClass}>
                  Request a new link
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Please wait…" : "Update password"}
      </Button>
    </form>
  );
}
