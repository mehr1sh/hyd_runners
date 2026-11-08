import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminClient, PASSWORD, testEmail, usesLocalDatabase, WRITES_DATA } from "./support/database";

/**
 * Password reset end to end: request → email (local Mailpit) → callback →
 * new password → sign-in. Needs local Supabase and SUPABASE_SECRET_KEY.
 */

// Writes accounts and data: never against the shared Production/Preview database.
test.skip(!usesLocalDatabase(), WRITES_DATA);

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const NEW_PASSWORD = "brand-new-stride-42";
const CONFIRMATION = /If an account exists for that address, we've sent a link/;
const LINK_INVALID = "This reset link is invalid or has expired. Request a new one.";

/** Polls Mailpit's API for the newest message to `email` and returns the reset link in it. */
async function resetLinkFor(request: APIRequestContext, email: string) {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${email}"` } });
        const body = (await search.json()) as { messages?: { ID: string }[] };
        id = body.messages?.[0]?.ID;
        return id;
      },
      { message: `reset email for ${email} in Mailpit`, timeout: 15_000 },
    )
    .toBeTruthy();
  const message = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { Text: string };
  const link = message.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\?[^\s)]+/)?.[0];
  expect(link, "verify link in the reset email").toBeTruthy();
  return link!;
}

/**
 * Follows Supabase's verify link and returns the URL it redirects to, moved
 * onto the origin under test.
 *
 * The app builds `redirectTo` from NEXT_PUBLIC_SITE_URL, which is compiled in
 * at build time (http://localhost:3000 in .env.local), while Playwright may
 * serve the app on another port (PORT=3100). The PKCE code verifier cookie was
 * set on the origin under test, and /auth/callback redirects on whatever origin
 * receives it, so moving the callback URL onto the test origin exercises
 * exactly the production path without rebuilding for each port.
 */
async function followVerifyLink(request: APIRequestContext, link: string, baseURL: string) {
  const response = await request.get(link, { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  const location = new URL(response.headers()["location"]);
  expect(
    location.pathname,
    "Supabase dropped redirect_to: allow /auth/callback** in the Auth redirect URLs (supabase/config.toml)",
  ).toBe("/auth/callback");
  const target = new URL(location.pathname + location.search, baseURL);
  return target.toString();
}

/** The form's alert, not Next.js's route announcer (which also has role="alert"). */
const formAlert = (page: Page) => page.locator('[data-slot="alert"][role="alert"]');

async function requestReset(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const status = page.getByRole("status");
  await expect(status).toHaveText(CONFIRMATION);
  await expect(status).toBeFocused();
  return status.textContent();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("password reset", () => {
  test.beforeEach(async ({ request }) => {
    const health = await (await request.get("/api/v1/health")).json();
    test.skip(!health.data.supabaseConfigured, "Supabase not configured");
  });

  test("a runner resets a forgotten password from the emailed link", async ({
    page,
    browser,
    request,
    baseURL,
  }, testInfo) => {
    const admin = adminClient();
    test.skip(!admin, "SUPABASE_SECRET_KEY not available");
    const email = testEmail("reset", testInfo.project.name);
    const { data, error } = await admin!.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Reset Runner" },
    });
    expect(error).toBeNull();

    try {
      const existingConfirmation = await requestReset(page, email);

      const link = await resetLinkFor(request, email);
      await page.goto(await followVerifyLink(request, link, baseURL!));
      await expect(page).toHaveURL(/\/reset-password$/);

      // Mismatched confirmation is caught before Supabase is called.
      await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Confirm new password").fill(`${NEW_PASSWORD}-typo`);
      await page.getByRole("button", { name: "Update password" }).click();
      await expect(formAlert(page)).toHaveText(/do not match/i);

      // Reusing the current password is rejected by Supabase (same_password).
      await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Confirm new password").fill(PASSWORD);
      await page.getByRole("button", { name: "Update password" }).click();
      await expect(formAlert(page)).toHaveText(/different from your current/i);

      await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Update password" }).click();
      await expect(page).toHaveURL(/\/dashboard\?notice=password-updated$/);
      await expect(page.getByRole("status").filter({ hasText: "Password updated." })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello, Reset Runner");

      // The emailed link is single-use: opening it again behaves like an expired link.
      await page.goto(await followVerifyLink(request, link, baseURL!));
      await expect(page).toHaveURL(/\/forgot-password\?error=link_invalid$/);
      await expect(formAlert(page)).toHaveText(LINK_INVALID);

      // In a fresh browser: the old password fails, the new one works.
      const fresh = await browser.newContext();
      try {
        const other = await fresh.newPage();
        await signIn(other, email, PASSWORD);
        await expect(formAlert(other)).toHaveText("Email or password is incorrect.");
        await signIn(other, email, NEW_PASSWORD);
        await expect(other).toHaveURL(/\/dashboard$/);

        // An unknown address gets exactly the same confirmation.
        const unknown = await requestReset(other, testEmail("reset-nobody", testInfo.project.name));
        expect(unknown).toBe(existingConfirmation);
      } finally {
        await fresh.close();
      }
    } finally {
      if (data.user) await admin!.auth.admin.deleteUser(data.user.id);
    }
  });

  test("an unknown address sees the same confirmation and no email is sent", async ({ page, request }, testInfo) => {
    const email = testEmail("reset-unknown", testInfo.project.name);
    await requestReset(page, email);
    const search = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${email}"` } });
    expect(((await search.json()) as { messages_count: number }).messages_count).toBe(0);
  });

  // Real expiry (otp_expiry, one hour) is impractical to wait for. Supabase
  // reports expired, used and unknown links the same way (a failed code
  // exchange, or ?error=…&error_code=otp_expired on the redirect), so these
  // cases exercise the same handling.
  test("an invalid code at the callback lands on the request page", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&next=/reset-password");
    await expect(page).toHaveURL(/\/forgot-password\?error=link_invalid$/);
    await expect(formAlert(page)).toHaveText(LINK_INVALID);
  });

  test("Supabase's expired-link error is shown without reflecting its text", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=access_denied&error_code=otp_expired&error_description=Injected+%3Cb%3Etext%3C%2Fb%3E&next=/reset-password",
    );
    await expect(page).toHaveURL(/\/forgot-password\?error=link_invalid$/);
    await expect(formAlert(page)).toHaveText(LINK_INVALID);
    await expect(page.getByText(/Injected/)).toHaveCount(0);
  });

  test("the reset page without a session explains how to get a new link", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("status")).toHaveText(/expired or was opened in a different browser/i);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Request a new link" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});
