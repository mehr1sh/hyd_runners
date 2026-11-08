import { z } from "zod";

/** Shared field rules: sign-in, sign-up and password reset validate the same way. */
export const EmailAddress = z.email("Enter a valid email address.");
export const Password = z.string().min(8, "Use at least 8 characters.");

export const Credentials = z.object({ email: EmailAddress, password: Password });

function hasControlCharacter(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A redirect target is accepted only as a same-origin relative path. Rejects
 * absolute and protocol-relative URLs (`https://x`, `//x`), backslashes (which
 * browsers treat as `/`, so `/\x` means `//x`) and control characters (browsers
 * strip tabs and newlines, so `/\t/x` also becomes `//x`).
 */
export function safeNextPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return fallback;
  }
  if (hasControlCharacter(value)) return fallback;
  // Belt and braces: the path must resolve to the origin it is resolved against.
  const base = "http://same-origin.invalid";
  try {
    if (new URL(value, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return value;
}

export function authErrorMessage(code: string | undefined, fallback: "sign-in" | "sign-up") {
  switch (code) {
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Confirm your email before signing in.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "weak_password":
      return "Use at least 8 characters.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return fallback === "sign-in"
        ? "Could not sign in. Check your email and password."
        : "Could not create your account. Check the details and try again.";
  }
}
