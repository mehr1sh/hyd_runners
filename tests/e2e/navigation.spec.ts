import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Six sections, section tabs, and every existing page still reachable. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("navigation is organised into six sections with section tabs", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e-nav-${stamp}@example.test`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Nav ${stamp}` },
  });
  if (error) throw new Error(error.message);
  await signInAs(page, email);
  const mobile = testInfo.project.name === "mobile";
  const main = page.getByRole("navigation", { name: "Main" }).locator("visible=true");

  if (mobile) {
    for (const label of ["Today", "Train", "Explore", "Community"])
      await expect(main.getByRole("link", { name: label })).toBeVisible();
    await main.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Events" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Profile" })).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(main.getByRole("link")).toHaveText(["Today", "Train", "Explore", "Community", "Events", "Profile"]);
  }

  await main.getByRole("link", { name: "Train" }).click();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByText(/planned this week/)).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Section" });
  await tabs.getByRole("link", { name: "Workouts" }).click();
  await expect(page).toHaveURL(/\/workouts$/);
  await expect(main.getByRole("link", { name: "Train" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Workouts" })).toHaveAttribute("aria-current", "page");

  await main.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await page
    .getByRole("link", { name: /Routes/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/routes$/);
  await expect(main.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");

  // Every pre-existing page keeps its URL.
  for (const path of [
    "/dashboard",
    "/schedule",
    "/programmes",
    "/workouts",
    "/reports",
    "/community",
    "/clubs",
    "/events",
    "/map",
    "/runs",
    "/profile",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
