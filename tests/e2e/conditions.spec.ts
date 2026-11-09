import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Run conditions: in tests the server uses the labelled sample provider, never live weather. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner sees whether to run now or later, labelled as sample data in tests", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const email = `e2e-cond-${testInfo.project.name}-${Date.now()}@example.test`;
  const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(error.message);
  await signInAs(page, email);

  await page.goto("/conditions");
  await expect(page.getByRole("heading", { name: "Run now or later?" })).toBeVisible();
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample data for testing. Not live weather.").first()).toBeVisible();
  await expect(page.getByText("Data from MET Norway")).toHaveCount(0);
  await expect(page.getByText(/^(Go now|Better at|No good window soon)/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Hourly running conditions" }).locator("tbody tr")).toHaveCount(24);
  await expect(page.getByText(/no air-quality provider is set up/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Conditions" })).toHaveAttribute("aria-current", "page");

  const options = await page.getByLabel("Place").locator("option").count();
  if (options > 1) {
    await page.getByLabel("Place").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/place=/);
    await expect(page.getByRole("heading", { name: "Run now or later?" })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
