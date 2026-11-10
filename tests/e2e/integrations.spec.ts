import { expect, test } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** The integrations page reports each source's real status. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

test("connected apps lists only working sources as available", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const email = `e2e-int-${testInfo.project.name}${Date.now()}@example.test`;
  await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Integrations" },
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto("/profile");
  await page.getByRole("link", { name: "Connected apps and devices" }).click();
  const list = page.getByRole("list", { name: "Activity sources" });
  await expect(list.getByRole("listitem").filter({ hasText: "GPX and FIT files" })).toContainText("Available");
  await expect(list.getByRole("listitem").filter({ hasText: "Strava" })).toContainText("Not available");
  await expect(list.getByRole("listitem").filter({ hasText: "Health Connect" })).toContainText(
    "Coming with the HYD Runners app",
  );
  await expect(list.getByText("Available", { exact: true })).toHaveCount(1);
});
