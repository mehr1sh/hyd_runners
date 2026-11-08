import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Group runs: a club admin starts a weekly run; runners find it and see its pace groups. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a club admin starts a weekly beginner run that runners can join", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const title = `Dawn loop ${stamp}`;
  const emails = { clubAdmin: `e2e-gr-admin-${stamp}@example.test`, runner: `e2e-gr-runner-${stamp}@example.test` };
  const ids: Record<string, string> = {};
  for (const [key, email] of Object.entries(emails)) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `GR ${key} ${stamp}` },
    });
    if (error) throw new Error(error.message);
    ids[key] = data.user.id;
  }
  const slug = `gr-club-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const { data: club, error } = await admin
    .from("clubs")
    .insert({ slug, name: `GR Club ${stamp}`, join_policy: "open" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await admin.from("club_members").insert({
    club_id: club.id,
    user_id: ids.clubAdmin,
    role: "admin",
    status: "active",
    joined_at: new Date().toISOString(),
  });

  await signInAs(page, emails.clubAdmin);
  await page.goto(`/clubs/${slug}/manage`);
  await page.getByRole("tab", { name: "Weekly runs" }).click();
  await page.getByLabel("Run name").fill(title);
  await page.getByLabel("Every", { exact: true }).selectOption({ label: "Saturday" });
  await page.getByLabel("Beginner friendly", { exact: true }).check();
  await page.getByRole("button", { name: "Create group run" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("list", { name: "Upcoming runs" }).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Schedule runs" }).click();
  await expect(page.getByText("Already scheduled for that period.")).toBeVisible();
  const seriesPath = new URL(page.url()).pathname;

  await signInAs(page, emails.runner);
  await page.goto("/runs?level=beginner");
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`${seriesPath}$`));
  await expect(page.getByText("How we regroup:")).toBeVisible();
  await page.getByRole("list", { name: "Upcoming runs" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Pace groups" })).toBeVisible();
  await expect(page.getByText("6:30–7:30 min/km")).toBeVisible();
  await expect(page.getByText("Run-walk", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "I'm going" }).click();
  await expect(page.getByText("You're going!")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
