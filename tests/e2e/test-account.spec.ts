import { expect, test } from "@playwright/test";
import { testAccount, usesLocalDatabase } from "./support/database";

/**
 * Read-only check that is safe against the shared Production/Preview
 * database: sign in as the dedicated test account, open every runner page and
 * sign out, without creating or changing data. Against a deployed URL set
 * PLAYWRIGHT_BASE_URL, E2E_RUNNER_EMAIL and E2E_RUNNER_PASSWORD.
 */

const RUNNER_PAGES = [
  "/dashboard",
  "/schedule",
  "/programmes",
  "/workouts",
  "/reports",
  "/community",
  "/events",
  "/map",
];

test("the test account signs in and every runner page renders without server errors", async ({ page, request }) => {
  const health = await (await request.get("/api/v1/health")).json();
  test.skip(!health.data.supabaseConfigured, "Supabase not configured");
  const account = await testAccount();
  test.skip(
    !account,
    usesLocalDatabase() ? "SUPABASE_SECRET_KEY not available" : "Set E2E_RUNNER_EMAIL and E2E_RUNNER_PASSWORD",
  );
  if (!account) return;

  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  for (const route of RUNNER_PAGES) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
    await expect(page.getByText("Something went wrong"), route).toHaveCount(0);
    const rsc = await page.evaluate(async (r) => (await fetch(r, { headers: { RSC: "1" } })).text(), route);
    expect(rsc, `${route} streamed a server error`).not.toMatch(/E\{"digest"/);
  }
  expect(consoleErrors.filter((e) => /#441|#418|#423|hydrat/i.test(e))).toEqual([]);

  await page.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).not.toHaveURL(/\/dashboard/);
});
