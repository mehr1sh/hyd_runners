import { z } from "zod";
import { EmailAddress, Password } from "./auth";

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
/** Query value the dashboard reads to confirm a completed reset. */
export const PASSWORD_UPDATED_NOTICE = "password-updated";

/**
 * Shown after every well-formed request, whether or not an account exists and
 * whether or not Supabase reported an error, so the page never reveals which
 * addresses are registered.
 */
export const RESET_REQUESTED_MESSAGE =
  "If an account exists for that address, we've sent a link to reset your password. It can take a few minutes to arrive; check your spam folder too.";

export const RESET_LINK_INVALID_MESSAGE = "This reset link is invalid or has expired. Request a new one.";

export const RESET_SESSION_MISSING_MESSAGE =
  "Your reset link has expired or was opened in a different browser. Request a new email to choose a password.";

export const ForgotPasswordForm = z.object({ email: z.string().trim().pipe(EmailAddress) });

/** Same rules as sign-up (`Password`), plus a matching confirmation. */
export const ResetPasswordForm = z
  .object({ password: Password, confirmPassword: z.string() })
  .refine((form) => form.password === form.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Where Supabase sends the user from the reset email: the shared auth callback
 * (PKCE code exchange), continuing to the reset page. Built from the configured
 * site URL, never from the request's Host header.
 */
export function passwordResetRedirectUrl(siteUrl: string) {
  const url = new URL("/auth/callback", siteUrl);
  url.searchParams.set("next", RESET_PASSWORD_PATH);
  return url.toString();
}

/** Supabase redirects back with these when a link is expired, used or otherwise rejected. */
export function hasAuthErrorParams(params: URLSearchParams) {
  return params.has("error") || params.has("error_code") || params.has("error_description");
}

/**
 * Where the callback sends the user when the link cannot be used. Raw error
 * text from the URL is never passed on; the target page shows a fixed message.
 */
export function callbackFailurePath(next: string) {
  return next === RESET_PASSWORD_PATH ? `${FORGOT_PASSWORD_PATH}?error=link_invalid` : "/sign-in?error=callback";
}

/** Only the one known value maps to a message; anything else in the URL is ignored. */
export function forgotPasswordNotice(error: unknown) {
  return error === "link_invalid" ? RESET_LINK_INVALID_MESSAGE : null;
}

const SESSION_ERROR_CODES = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "bad_jwt",
  "no_authorization",
  "user_not_found",
  "reauthentication_needed",
]);

export type PasswordUpdateError = { message: string; sessionMissing: boolean };

/** Maps a Supabase `updateUser` error to a message the reset form can show. */
export function passwordUpdateError(error: { code?: string; name?: string }): PasswordUpdateError {
  if (error.name === "AuthSessionMissingError" || (error.code && SESSION_ERROR_CODES.has(error.code))) {
    return { message: RESET_SESSION_MISSING_MESSAGE, sessionMissing: true };
  }
  switch (error.code) {
    case "same_password":
      return { message: "Your new password must be different from your current one.", sessionMissing: false };
    case "weak_password":
      return {
        message: "That password is too weak. Use at least 8 characters and avoid common passwords.",
        sessionMissing: false,
      };
    case "over_request_rate_limit":
      return { message: "Too many attempts. Wait a moment and try again.", sessionMissing: false };
    default:
      return { message: "Could not update your password. Try again.", sessionMissing: false };
  }
}
