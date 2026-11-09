import { expect, test, type Page } from "@playwright/test";
import { gpx, track } from "../unit/activities/fixtures";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Performance Lab from real imports: summary, personal bests, distance bands, year report, same-route comparison. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

async function importGpx(page: Page, text: string, name: string) {
  await page.goto("/activities/import");
  await page
    .getByLabel("GPX or FIT file (up to 15 MB)")
    .setInputFiles({ name: `${name}.gpx`, mimeType: "application/gpx+xml", buffer: Buffer.from(text) });
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByRole("button", { name: "Import activity" }).click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 20_000 });
}

test("the Performance Lab summarises real imports and compares runs on the same route", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e-perf-${stamp}@example.test`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Perf ${stamp}` },
  });
  if (error) throw new Error(error.message);
  await signInAs(page, email);

  await page.goto("/performance");
  await expect(page.getByText("Import an activity to start")).toBeVisible();

  // The same 5.4 km route on two days of this month; the second is faster.
  const day = (d: number) => new Date(Date.UTC(2026, 10, d, 0, 40));
  await importGpx(page, gpx(track({ start: day(2), seconds: 1800, speedMs: 3.0 })), "Tuesday loop");
  await importGpx(page, gpx(track({ start: day(5), seconds: 1680, speedMs: 3.2 })), "Friday loop");

  await expect(page.getByRole("heading", { name: "Pacing" })).toBeVisible();
  await expect(page.getByText(/Even split/)).toBeVisible();
  const same = page.getByRole("table", { name: "Your activities on the same route" });
  await expect(same.getByRole("row")).toHaveCount(3);
  await expect(same).toContainText("This run");

  await page.goto("/performance?range=month");
  await expect(page.getByRole("heading", { name: "This month", exact: true })).toBeVisible();
  await expect(page.getByText(/^10\.7\d km$/).first()).toBeVisible();
  const bests = page
    .getByRole("region", { name: "Personal bests" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "Personal bests" }) }));
  await expect(bests.getByRole("row", { name: /^5 km/ })).toContainText(/2[56]:\d\d/);
  await expect(bests.getByRole("row", { name: /^10 km/ })).toContainText("No run that long yet");
  await expect(page.getByText("Not official race results.", { exact: false })).toBeVisible();
  await expect(page.getByRole("row", { name: /^3–6 km/ })).toContainText("2 runs");
  await expect(page.getByText("Most repeated route")).toBeVisible();
  await expect(page.getByText("2 times")).toBeVisible();
  await expect(page.getByText(/Import at least four activities/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
