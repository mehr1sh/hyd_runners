import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callbackFailurePath,
  ForgotPasswordForm,
  forgotPasswordNotice,
  hasAuthErrorParams,
  passwordResetRedirectUrl,
  passwordUpdateError,
  RESET_LINK_INVALID_MESSAGE,
  RESET_REQUESTED_MESSAGE,
  RESET_SESSION_MISSING_MESSAGE,
  ResetPasswordForm,
} from "@/features/identity/logic/password-reset";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    isSupabaseConfigured: true,
    publicEnv: { ...actual.publicEnv, NEXT_PUBLIC_SITE_URL: "https://hydrunners.example" },
  };
});

type AuthResult = { data: unknown; error: { code?: string; name?: string; message: string; status?: number } | null };

/** Records auth calls; each method answers with the configured result. */
function fakeAuthClient(
  results: {
    reset?: AuthResult;
    claims?: Record<string, unknown> | null;
    update?: AuthResult;
    signOut?: { error: { message: string } | null };
    exchange?: AuthResult;
  } = {},
) {
  return {
    auth: {
      resetPasswordForEmail: vi.fn(async () => results.reset ?? { data: {}, error: null }),
      getClaims: vi.fn(async () => {
        const claims = results.claims === undefined ? { sub: "user-1" } : results.claims;
        return { data: claims ? { claims } : null, error: null };
      }),
      updateUser: vi.fn(async () => results.update ?? { data: { user: { id: "user-1" } }, error: null }),
      signOut: vi.fn(async () => results.signOut ?? { error: null }),
      exchangeCodeForSession: vi.fn(
        async () => results.exchange ?? { data: { user: {}, session: {}, redirectType: null }, error: null },
      ),
    },
  };
}

let client: ReturnType<typeof fakeAuthClient>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { requestPasswordReset, resetPassword } = await import("@/features/identity/actions");
const { GET: callback } = await import("@/app/auth/callback/route");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  client = fakeAuthClient();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("ForgotPasswordForm", () => {
  it("accepts and trims a valid address", () => {
    expect(ForgotPasswordForm.parse({ email: "  asha@example.test " })).toEqual({ email: "asha@example.test" });
  });

  it.each([[""], ["not-an-email"], ["asha@"], [null]])("rejects %j", (email) => {
    expect(ForgotPasswordForm.safeParse({ email }).success).toBe(false);
  });
});

describe("ResetPasswordForm (same rules as sign-up)", () => {
  it("accepts a matching password of 8 or more characters", () => {
    expect(ResetPasswordForm.safeParse({ password: "new-password-1", confirmPassword: "new-password-1" }).success).toBe(
      true,
    );
  });

  it("rejects a short password with the sign-up message", () => {
    const result = ResetPasswordForm.safeParse({ password: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Use at least 8 characters.");
  });

  it("rejects a confirmation that does not match", () => {
    const result = ResetPasswordForm.safeParse({ password: "new-password-1", confirmPassword: "new-password-2" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/do not match/i);
  });
});

describe("passwordResetRedirectUrl", () => {
  it("goes through the auth callback and continues to the reset page", () => {
    expect(passwordResetRedirectUrl("https://hydrunners.vercel.app")).toBe(
      "https://hydrunners.vercel.app/auth/callback?next=%2Freset-password",
    );
  });

  it("does not double the slash when the site URL ends with one", () => {
    expect(passwordResetRedirectUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/auth/callback?next=%2Freset-password",
    );
  });
});

describe("passwordUpdateError", () => {
  it("maps same_password and weak_password to specific messages", () => {
    expect(passwordUpdateError({ code: "same_password" })).toEqual({
      message: expect.stringMatching(/different from your current/i),
      sessionMissing: false,
    });
    expect(passwordUpdateError({ code: "weak_password" }).message).toMatch(/too weak/i);
  });

  it.each([["session_not_found"], ["session_expired"], ["refresh_token_not_found"], ["bad_jwt"]])(
    "treats %s as a missing session",
    (code) => {
      expect(passwordUpdateError({ code })).toEqual({ message: RESET_SESSION_MISSING_MESSAGE, sessionMissing: true });
    },
  );

  it("treats the client's AuthSessionMissingError as a missing session", () => {
    expect(passwordUpdateError({ name: "AuthSessionMissingError" }).sessionMissing).toBe(true);
  });

  it("falls back to a generic message", () => {
    expect(passwordUpdateError({ code: "unexpected_failure" })).toEqual({
      message: "Could not update your password. Try again.",
      sessionMissing: false,
    });
  });
});

describe("callback error handling helpers", () => {
  it("detects Supabase error parameters", () => {
    expect(hasAuthErrorParams(new URLSearchParams("error=access_denied&error_code=otp_expired"))).toBe(true);
    expect(hasAuthErrorParams(new URLSearchParams("error_description=whatever"))).toBe(true);
    expect(hasAuthErrorParams(new URLSearchParams("code=abc&next=/reset-password"))).toBe(false);
  });

  it("sends failed reset links to the request page, others to sign-in", () => {
    expect(callbackFailurePath("/reset-password")).toBe("/forgot-password?error=link_invalid");
    expect(callbackFailurePath("/onboarding")).toBe("/sign-in?error=callback");
  });

  it("maps only the known notice value to a fixed message", () => {
    expect(forgotPasswordNotice("link_invalid")).toBe(RESET_LINK_INVALID_MESSAGE);
    expect(forgotPasswordNotice("Email link is invalid or has expired")).toBeNull();
    expect(forgotPasswordNotice(["link_invalid"])).toBeNull();
    expect(forgotPasswordNotice(undefined)).toBeNull();
  });
});

describe("requestPasswordReset", () => {
  const idle = { status: "idle" } as const;

  it("validates the email before calling Supabase", async () => {
    const state = await requestPasswordReset(idle, form({ email: "nope" }));
    expect(state).toEqual({ status: "error", message: "Enter a valid email address." });
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the link through the callback built from the configured site URL", async () => {
    await requestPasswordReset(idle, form({ email: "asha@example.test" }));
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("asha@example.test", {
      redirectTo: "https://hydrunners.example/auth/callback?next=%2Freset-password",
    });
  });

  it("answers identically for existing, unknown, rate-limited and failing requests", async () => {
    const outcomes: AuthResult[] = [
      // Existing account and unknown address both succeed silently in Supabase.
      { data: {}, error: null },
      // Per-address rate limit: only ever returned for an existing account.
      {
        data: null,
        error: { code: "over_email_send_rate_limit", status: 429, message: "only request this after 30 seconds" },
      },
      { data: null, error: { code: "over_request_rate_limit", status: 429, message: "rate limit" } },
      { data: null, error: { code: "unexpected_failure", status: 500, message: "SMTP down" } },
      { data: null, error: { code: "email_address_invalid", status: 400, message: "invalid" } },
    ];
    const states = [];
    for (const reset of outcomes) {
      client = fakeAuthClient({ reset });
      states.push(await requestPasswordReset(idle, form({ email: "someone@example.test" })));
    }
    for (const state of states) expect(state).toEqual({ status: "sent", message: RESET_REQUESTED_MESSAGE });
    // Errors are logged server-side, without the address.
    expect(consoleError).toHaveBeenCalledTimes(4);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("someone@example.test");
  });
});

describe("resetPassword", () => {
  const idle = { status: "idle" } as const;
  const valid = { password: "brand-new-pass", confirmPassword: "brand-new-pass" };

  it("updates the password, signs out other sessions and goes to the dashboard", async () => {
    await expect(resetPassword(idle, form(valid))).rejects.toThrow("redirect:/dashboard?notice=password-updated");
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "brand-new-pass" });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("validates before touching Supabase", async () => {
    const state = await resetPassword(idle, form({ password: "short", confirmPassword: "short" }));
    expect(state).toEqual({ status: "error", message: "Use at least 8 characters." });
    const mismatch = await resetPassword(idle, form({ ...valid, confirmPassword: "something-else" }));
    expect(mismatch.message).toMatch(/do not match/i);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("reports a missing session with a way to request a new link", async () => {
    client = fakeAuthClient({ claims: null });
    const state = await resetPassword(idle, form(valid));
    expect(state).toEqual({ status: "error", message: RESET_SESSION_MISSING_MESSAGE, sessionMissing: true });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps same_password from Supabase", async () => {
    client = fakeAuthClient({ update: { data: null, error: { code: "same_password", message: "same", status: 422 } } });
    const state = await resetPassword(idle, form(valid));
    expect(state).toMatchObject({ status: "error", sessionMissing: false });
    expect(state.message).toMatch(/different from your current/i);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("maps an expired session from Supabase", async () => {
    client = fakeAuthClient({
      update: { data: null, error: { code: "session_not_found", message: "gone", status: 403 } },
    });
    expect(await resetPassword(idle, form(valid))).toMatchObject({ sessionMissing: true });
  });

  it("still finishes when signing out other sessions fails", async () => {
    client = fakeAuthClient({ signOut: { error: { message: "network" } } });
    await expect(resetPassword(idle, form(valid))).rejects.toThrow("redirect:/dashboard?notice=password-updated");
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("GET /auth/callback", () => {
  const ORIGIN = "http://localhost:3100";
  async function locationFor(query: string) {
    const response = await callback(new NextRequest(`${ORIGIN}/auth/callback?${query}`));
    expect(response.status).toBe(307);
    return response.headers.get("location");
  }

  it("exchanges a recovery code and continues to the reset page", async () => {
    client = fakeAuthClient({ exchange: { data: { user: {}, session: {}, redirectType: "recovery" }, error: null } });
    expect(await locationFor("code=good&next=/reset-password")).toBe(`${ORIGIN}/reset-password`);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("good");
  });

  it("sends a recovery session to the reset page even if next was lost or changed", async () => {
    client = fakeAuthClient({ exchange: { data: { user: {}, session: {}, redirectType: "recovery" }, error: null } });
    expect(await locationFor("code=good&next=/community")).toBe(`${ORIGIN}/reset-password`);
  });

  it("keeps the existing behaviour for confirmation links", async () => {
    expect(await locationFor("code=good&next=/onboarding")).toBe(`${ORIGIN}/onboarding`);
    expect(await locationFor("code=good")).toBe(`${ORIGIN}/dashboard`);
  });

  it.each([["//evil.com"], ["/\\evil.com"], ["https://evil.com"], ["/\t/evil.com"]])(
    "never redirects off-site for next=%s",
    async (next) => {
      expect(await locationFor(`code=good&next=${encodeURIComponent(next)}`)).toBe(`${ORIGIN}/dashboard`);
    },
  );

  it("sends an invalid or used reset code to the request page", async () => {
    client = fakeAuthClient({
      exchange: { data: { user: null, session: null }, error: { code: "flow_state_not_found", message: "bad" } },
    });
    expect(await locationFor("code=garbage&next=/reset-password")).toBe(`${ORIGIN}/forgot-password?error=link_invalid`);
  });

  it("handles Supabase's expired-link parameters without exchanging or reflecting them", async () => {
    const location = await locationFor(
      "error=access_denied&error_code=otp_expired&error_description=%3Cb%3Eowned%3C%2Fb%3E&next=/reset-password",
    );
    expect(location).toBe(`${ORIGIN}/forgot-password?error=link_invalid`);
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("treats a missing code as an invalid link", async () => {
    expect(await locationFor("next=/reset-password")).toBe(`${ORIGIN}/forgot-password?error=link_invalid`);
    expect(await locationFor("next=/onboarding")).toBe(`${ORIGIN}/sign-in?error=callback`);
  });
});
