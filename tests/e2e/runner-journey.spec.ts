import { expect, test } from "@playwright/test";
import { middayTimezone } from "./support/clock";
import { usesLocalDatabase, WRITES_DATA } from "./support/database";

// Writes accounts and data: never against the shared Production/Preview database.
test.skip(!usesLocalDatabase(), WRITES_DATA);

/**
 * Dashboard → programme session → complete → rewards → progress → community.
 * Needs Supabase (and SUPABASE_SECRET_KEY for server-side writes).
 */
test("a new runner completes a Couch to 5K session and earns rewards exactly once", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const health = await (await request.get("/api/v1/health")).json();
  test.skip(!health.data.supabaseConfigured, "Supabase not configured");

  const name = `Journey ${testInfo.project.name} ${Date.now() % 100000}`;
  await page.goto("/sign-up");
  await page.getByLabel(/what should we call you/i).fill(name);
  await page.getByLabel("Email").fill(`journey-${testInfo.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  // "Done for today" and "1/3 days" depend on the runner's local day; pin it
  // away from midnight so the result does not depend on when CI runs.
  await page.getByLabel("New to running").check();
  await page.getByLabel("I struggle to stay consistent").check();
  await page.getByLabel("Timezone").fill(middayTimezone());
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByLabel("Fitness goal")).toBeVisible();

  // Empty states come from real (empty) data.
  await page.goto("/dashboard");
  await expect(page.getByText("Nothing planned yet")).toBeVisible();
  await expect(page.getByText("0 XP", { exact: true })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByText("No workouts in this period")).toBeVisible();
  await page.goto("/workouts");
  await expect(page.getByText("No workouts yet")).toBeVisible();

  // Enrol and start the first session.
  await page.goto("/programmes/couch-to-5k");
  await page.getByRole("button", { name: "Start this programme" }).click();
  await expect(page.getByText("0 of 27")).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Week 1, run 1/ })).toBeVisible();

  // Complete it, firing the form twice to simulate a double submit.
  await page.getByLabel(/Active time/).fill("30");
  await page.getByLabel(/Distance/).fill("3.2");
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("form:has(input[name=workoutId])")!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(/completed=1/);
  await expect(page.getByText(/Workout saved\. You earned \d+ XP/)).toBeVisible();
  await expect(page.getByText("Badge: First steps")).toBeVisible();

  // Exactly one workout was stored.
  await page.goto("/workouts");
  await expect(page.getByRole("link", { name: "Week 1, run 1: intervals" })).toHaveCount(1);

  // Dashboard and programme progress update from the stored records.
  await page.goto("/dashboard");
  await expect(page.getByText("Done for today", { exact: true })).toBeVisible();
  await expect(page.getByText(/^[1-9]\d* XP$/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your progress" }).getByText("1/3 days", { exact: true }),
  ).toBeVisible();
  await page.goto("/programmes/couch-to-5k");
  await expect(page.getByText("1 of 27")).toBeVisible();
  await expect(page.getByText(/rest first/)).toBeVisible();

  // The runner appears on this week's leaderboard.
  await page.goto("/community");
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText("You");
  // Privacy: hiding yourself is saved (you still see your own row).
  await page.getByRole("button", { name: "Hide me" }).click();
  await expect(page.getByText("You are hidden from other runners.")).toBeVisible();
  await page.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByText("Other runners can see you on the leaderboard.")).toBeVisible();

  // RSVP to the seeded sample event (supabase/seed.sql), then cancel. Its page is
  // opened directly: the list is paged and other test runs add upcoming events.
  await page.goto("/events/00000000-0000-4000-8000-000000000201");
  await expect(page.getByRole("heading", { name: "Sample: Beginner walk-run" })).toBeVisible();
  const place = page.getByRole("region", { name: "Your place" });
  await place.getByRole("button", { name: "I'm going" }).click();
  await expect(place.getByText("You're going", { exact: true })).toBeVisible();
  await place.getByRole("button", { name: "Cancel my place" }).click();
  await expect(place.getByRole("button", { name: "I'm going" })).toBeVisible();
});
