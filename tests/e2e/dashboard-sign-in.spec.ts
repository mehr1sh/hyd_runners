import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, testEmail, usesLocalDatabase, WRITES_DATA } from "./support/database";

/**
 * Sign-in lands on a dashboard that renders on the server and hydrates
 * cleanly: no route error boundary, no RSC error rows (`E{"digest":…}`), no
 * React #441 or hydration errors in the console. Covers runners with and
 * without a profile/role row. Needs local Supabase and SUPABASE_SECRET_KEY.
 */

// Writes accounts and data: never against the shared Production/Preview database.
test.skip(!usesLocalDatabase(), WRITES_DATA);

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectHealthyDashboard(page: Page, consoleErrors: string[], greeting: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Account menu for / })).toBeVisible();

  const rsc = await page.evaluate(async () => (await fetch("/dashboard", { headers: { RSC: "1" } })).text());
  expect(rsc).not.toMatch(/E\{"digest"/);
  expect(consoleErrors.filter((e) => /#441|#418|#423|hydrat/i.test(e))).toEqual([]);
}

test.describe("dashboard after sign-in", () => {
  test.beforeEach(async ({ request }) => {
    const health = await (await request.get("/api/v1/health")).json();
    test.skip(!health.data.supabaseConfigured, "Supabase not configured");
    test.skip(!adminClient(), "SUPABASE_SECRET_KEY not available");
  });

  test("a runner with a complete profile sees their dashboard", async ({ page }, testInfo) => {
    const admin = adminClient()!;
    const email = testEmail("dash-full", testInfo.project.name);
    const { error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Asha Rao" },
    });
    expect(error).toBeNull();

    const consoleErrors = watchConsole(page);
    await signIn(page, email);
    await expectHealthyDashboard(page, consoleErrors, "Hello, Asha Rao");
    await expect(page.getByText("Nothing planned yet")).toBeVisible();
    await expect(page.getByText("0 XP", { exact: true })).toBeVisible();
  });

  test("a runner without a profile or role row still gets a working dashboard", async ({ page }, testInfo) => {
    const admin = adminClient()!;
    const email = testEmail("dash-noprofile", testInfo.project.name);
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    expect(error).toBeNull();
    const userId = data.user!.id;
    // Simulate an account created before the signup trigger existed.
    expect((await admin.from("user_roles").delete().eq("user_id", userId)).error).toBeNull();
    expect((await admin.from("profiles").delete().eq("id", userId)).error).toBeNull();

    const consoleErrors = watchConsole(page);
    await signIn(page, email);
    await expectHealthyDashboard(page, consoleErrors, "Hello, Runner");
    await expect(page.getByText("Nothing planned yet")).toBeVisible();
    // No role row means no staff navigation.
    await expect(page.getByRole("link", { name: /^Coach/ })).toHaveCount(0);
  });
});
