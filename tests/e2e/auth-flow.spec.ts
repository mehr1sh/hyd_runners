import { expect, test } from "@playwright/test";

/** Full sign-up → protected page → sign-out flow. Runs only when Supabase is configured. */
test("a new runner can sign up, reach the app and sign out", async ({ page, request }, testInfo) => {
  const health = await (await request.get("/api/v1/health")).json();
  test.skip(!health.data.supabaseConfigured, "Supabase not configured");

  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.test`;

  // Signed-out visitors are redirected away from protected routes.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);

  await page.goto("/sign-up");
  await page.getByLabel(/what should we call you/i).fill("E2E Runner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  // Local config has email confirmation off, so the runner lands in onboarding.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto("/profile");
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Runner", { exact: true })).toBeVisible();

  // Every runner page renders inside the app shell without horizontal scroll.
  for (const route of [
    "/dashboard",
    "/schedule",
    "/programmes",
    "/workouts",
    "/reports",
    "/community",
    "/events",
    "/map",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route} overflows horizontally`).toBeLessThanOrEqual(0);
  }

  // Runners cannot open staff areas.
  await page.goto("/manager");
  await expect(page.getByRole("heading", { name: /for staff/i })).toBeVisible();

  // The API sees the same session.
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).data).toMatchObject({ displayName: "E2E Runner", roles: ["runner"] });

  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/$/);
});
