"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, signUp, type AuthFormState } from "../actions";

const initialState: AuthFormState = { status: "idle" };

export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next?: string }) {
  const [state, formAction, pending] = useActionState(mode === "sign-in" ? signIn : signUp, initialState);

  if (state.status === "check_email") {
    return (
      <Alert role="status">
        <AlertDescription>
          Check your inbox for a confirmation link. After confirming, you will continue to onboarding.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FieldGroup>
        {mode === "sign-up" && (
          <Field>
            <FieldLabel htmlFor="displayName">What should we call you?</FieldLabel>
            <Input id="displayName" name="displayName" autoComplete="nickname" required maxLength={60} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </Field>
      </FieldGroup>

      {state.status === "error" && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "sign-in" ? (
          <>
            New to HYD Runners?{" "}
            <Link href="/sign-up" className="font-medium text-brand-red-strong underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-brand-red-strong underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
