export function safeNextPath(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/dashboard";
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
