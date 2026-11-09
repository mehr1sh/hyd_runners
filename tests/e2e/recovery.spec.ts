import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Recovery journal, readiness, strength logging with the muscle map, and the return-to-running proposal. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner journals recovery, sees readiness, logs strength and proposes a return to running", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const email = `e2e-rc-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Recovery Spec ${stamp}` },
  });
  if (error) throw new Error(error.message);
  const uid = data.user.id;

  await signInAs(page, email);
  await page.goto("/recovery");
  await expect(page.getByRole("heading", { name: "Recovery", level: 1 })).toBeVisible();
  await expect(page.getByText(/Missing: A journal entry for today/)).toBeVisible();

  // Log a tired, sore day: readiness says rest and explains why.
  await page.getByRole("radio", { name: "Fatigue 4 of 5" }).check({ force: true });
  await page.getByRole("radio", { name: "Muscle soreness 3 of 5" }).check({ force: true });
  await page.getByLabel("Hours of sleep").fill("7");
  await page.getByRole("checkbox", { name: "Calves" }).check();
  await page.getByLabel("Notes (optional, private)").fill("Heavy legs after the weekend");
  await page.getByRole("button", { name: "Save entry" }).click();
  const readiness = page.getByRole("region", { name: "Readiness today" });
  await expect(readiness.getByText("Rest day")).toBeVisible();
  await expect(readiness.getByText("You rated fatigue 4 of 5.")).toBeVisible();
  await expect(readiness.getByText("Self-reported").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Update entry" })).toBeVisible();
  const { data: stored } = await admin
    .from("recovery_entries")
    .select("fatigue, share_with_coach, soreness_areas")
    .eq("user_id", uid)
    .single();
  expect(stored).toEqual({ fatigue: 4, share_with_coach: false, soreness_areas: ["calves"] });

  // Strength: log a session and see it on the muscle map.
  await page.goto("/strength");
  await page.getByText("Strength: runner foundation").click();
  await page.getByRole("button", { name: "Log session" }).first().click();
  await expect(page.getByText(/Strength: runner foundation · 25 min · 6 exercises/)).toBeVisible();
  await expect(page.locator("figcaption")).toContainText(/Worked in the last 14 days: .*Glutes \(\d+\)/);
  await expect(page.getByRole("img", { name: /Muscles worked/ })).toBeVisible();

  // Return to running needs the acknowledgement, then becomes a proposal.
  await page.goto("/recovery/return-to-running");
  await page.getByRole("button", { name: "Propose a return-to-running plan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "confirm the statement" })).toBeVisible();
  await page.getByRole("checkbox", { name: /general guidance for returning after a break/ }).check();
  await page.getByRole("button", { name: "Propose a return-to-running plan" }).click();
  await expect(page.getByText(/Proposed\. Review and accept it/)).toBeVisible();
  await page.goto("/training");
  await expect(page.getByRole("article", { name: /Return to running: \d+ weeks/ })).toBeVisible();

  // Delete the journal entry.
  await page.goto("/recovery");
  await page.getByRole("button", { name: /Delete entry for/ }).click();
  await expect(page.getByRole("region", { name: "Entries" }).getByText("No entries yet.")).toBeVisible();
});
