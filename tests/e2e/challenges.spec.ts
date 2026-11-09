import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Challenges v2: a manager creates a challenge, a runner joins, logs a workout and is rewarded once. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner completes a city challenge by logging a workout and is rewarded once", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const title = `Show up once ${stamp}`;
  const emails = { manager: `e2e-ch-manager-${stamp}@example.test`, runner: `e2e-ch-runner-${stamp}@example.test` };
  let runnerId = "";
  for (const [key, email] of Object.entries(emails)) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `CH ${key} ${stamp}` },
    });
    if (error) throw new Error(error.message);
    if (key === "manager") await admin.from("user_roles").insert({ user_id: data.user.id, role: "programme_manager" });
    else runnerId = data.user.id;
  }

  await signInAs(page, emails.manager);
  await page.goto("/challenges");
  await page.getByLabel("Challenge name").fill(title);
  await page.getByLabel("What counts").selectOption("active_days");
  await page.getByLabel("Goal (km for distance challenges)").fill("1");
  const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Ends").fill(end);
  await page.getByLabel("Reward (XP, up to 500)").fill("75");
  await page.getByRole("button", { name: "Create challenge" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const challengePath = new URL(page.url()).pathname;

  await signInAs(page, emails.runner);
  await page.goto("/challenges");
  const card = page.getByRole("listitem").filter({ hasText: title });
  await card.getByRole("button", { name: "Join challenge" }).click();
  await expect(card.getByText(/You're in!/)).toBeVisible();

  await page.goto("/workouts/new");
  await page.getByLabel("What did you do?").fill("Easy jog");
  // An hour ago, in the browser's local time (the form rejects workouts ending in the future).
  const startLocal = await page.evaluate(() => {
    const d = new Date(Date.now() - 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  await page.getByLabel("Started at").fill(startLocal);
  await page.getByLabel("Active time (minutes)").fill("25");
  await page.getByRole("button", { name: "Save workout" }).click();
  await expect(page).not.toHaveURL(/\/workouts\/new$/);

  await page.goto(challengePath);
  await expect(page.getByText("Your progress: 1 of 1 days · completed ✓")).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: `CH runner ${stamp}` })).toContainText("✓");
  await page.reload();
  const { data: awards } = await admin
    .from("xp_ledger")
    .select("delta_xp")
    .eq("user_id", runnerId)
    .eq("reason", "challenge_completed");
  expect(awards).toEqual([{ delta_xp: 75 }]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
