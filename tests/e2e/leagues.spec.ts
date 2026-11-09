import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Leagues: an organiser creates a league and team, a runner joins with the code and sees transparent standings. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("an organiser runs a corporate league and runners compete on consistency", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const people = { m: `Organiser Lg${stamp}`, r: `Runner Lg${stamp}`, h: `Hidden Lg${stamp}` };
  const ids: Record<string, string> = {};
  for (const k of ["m", "r", "h"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `e2e-lg-${k}-${stamp}@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: people[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  await admin.from("user_roles").insert({ user_id: ids.m, role: "programme_manager" });
  await admin.from("runner_settings").insert({ user_id: ids.h, show_on_leaderboard: false });
  for (const [who, daysAgo] of [
    ["r", 1],
    ["r", 2],
    ["h", 1],
  ] as const) {
    const start = new Date(Date.now() - daysAgo * 86_400_000);
    await admin.from("activities").insert({
      user_id: ids[who],
      activity_type: "run",
      status: "ready",
      source_format: "gpx",
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 1800_000).toISOString(),
      elapsed_seconds: 1800,
      moving_seconds: 1800,
      moving_source: "derived",
      distance_m: 6000,
      avg_pace_s: 300,
      has_gps: false,
    });
  }

  // Organiser: create, add a team, open.
  await signInAs(page, `e2e-lg-m-${stamp}@example.test`);
  await page.goto("/leagues");
  await page.getByLabel("League name").fill(`HITEC League ${stamp}`);
  await page.getByLabel("Type").selectOption("corporate");
  await page.getByLabel("Starts").fill(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel("Ends").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: `HITEC League ${stamp}` })).toBeVisible();
  await page.getByLabel("Team name").fill("Cyber Striders");
  await page.getByLabel("Team type").selectOption("corporate");
  await page.getByRole("button", { name: "Add team" }).click();
  const code = (await page.getByText(/^Code [A-Z0-9]{8}$/).textContent())!.replace("Code ", "");
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Save league" }).click();
  await expect(page.getByText("League updated.")).toBeVisible();
  const leagueUrl = page.url();

  // Runners join with the code.
  for (const k of ["r", "h"] as const) {
    await signInAs(page, `e2e-lg-${k}-${stamp}@example.test`);
    await page.goto(leagueUrl);
    if (k === "r") {
      await page.getByLabel("Join code for Cyber Striders").fill("WRONG123");
      await page.getByRole("button", { name: "Join Cyber Striders" }).click();
      await expect(page.getByText("That code isn't right.")).toBeVisible();
    }
    await page.getByLabel("Join code for Cyber Striders").fill(code.toLowerCase());
    await page.getByRole("button", { name: "Join Cyber Striders" }).click();
    await expect(page.getByRole("region", { name: "Your team" })).toContainText("Cyber Striders");
  }

  // Viewed by the visible runner: the hidden runner counts for the team but isn't named.
  await signInAs(page, `e2e-lg-r-${stamp}@example.test`);
  await page.goto(leagueUrl);
  const teams = page.getByRole("region", { name: /Team standings/ });
  await expect(teams).toContainText("Cyber Striders");
  // 3 active days × 10 + floor(18 km / 5) × 5 = 45 points.
  await expect(teams.getByRole("row", { name: /Cyber Striders/ })).toContainText("45");
  const runners = page.getByRole("region", { name: "Runners" });
  await expect(runners).toContainText(people.r);
  await expect(runners).toContainText("Hidden runner");
  await expect(runners).not.toContainText(people.h);
  await expect(page.getByRole("region", { name: "How points work" })).toContainText("per active day");
});
