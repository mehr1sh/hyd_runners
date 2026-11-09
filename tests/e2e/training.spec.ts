import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Race preparation: goal, generated plan accepted in part, missed-session recovery, pace and workout tools. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

test("a runner sets a race goal, accepts part of a generated plan and recovers a missed session", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const email = `e2e-tr-${stamp}@example.test`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Training Spec ${stamp}` },
  });
  if (error) throw new Error(error.message);
  const uid = created.user.id;

  // A recent 10 km effort gives race estimates; a planned easy run two days ago was never done.
  const start = new Date(Date.now() - 10 * 86_400_000);
  const { error: actError } = await admin.from("activities").insert({
    user_id: uid,
    activity_type: "run",
    name: "Tempo 10k",
    status: "ready",
    source_format: "gpx",
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + 3300_000).toISOString(),
    elapsed_seconds: 3300,
    moving_seconds: 3300,
    moving_source: "derived",
    distance_m: 10000,
    avg_pace_s: 330,
    has_gps: false,
    best_efforts: { "5k": 1620, "10k": 3300 },
  });
  if (actError) throw new Error(actError.message);
  const missedAt = new Date(Date.now() - 2 * 86_400_000);
  missedAt.setUTCHours(1, 0, 0, 0);
  const { data: missed, error: wError } = await admin
    .from("scheduled_workouts")
    .insert({
      user_id: uid,
      title: "Easy run",
      workout_type: "run",
      starts_at: missedAt.toISOString(),
      duration_minutes: 30,
      planned_by: "runner",
    })
    .select("id")
    .single();
  if (wError) throw new Error(wError.message);

  await signInAs(page, email);
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Race preparation" })).toBeVisible();
  await expect(page.getByText(/10K: 55:00/)).toBeVisible();

  // Race goal: a 10K about ten weeks out.
  await page.getByLabel("Distance").selectOption("10k");
  await page.getByLabel("Race date").fill(isoDate(new Date(Date.now() + 70 * 86_400_000)));
  await page.getByLabel("Race name (optional)").fill("Spec City 10K");
  await page.getByLabel("Target time (optional)").fill("52:30");
  await page.getByLabel("Training days per week").selectOption("4");
  await page.getByRole("button", { name: "Save race goal" }).click();
  await expect(page.getByText(/Spec City 10K ·/)).toBeVisible();
  await expect(page.getByText(/slower than your target/)).toBeVisible();

  // Generate and review a plan; nothing is scheduled yet.
  await page.getByRole("button", { name: "Generate a plan" }).click();
  const plan = page.getByRole("article", { name: /-week 10K plan/ });
  await expect(plan).toBeVisible();
  const { count: before } = await admin
    .from("scheduled_workouts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("status", "planned");
  expect(before).toBe(1);
  await expect(plan.getByText(/A generated recommendation/)).toBeVisible();

  // Leave out the first week's long run.
  await plan.locator("details").first().locator("summary").click();
  const firstLong = plan
    .locator("details")
    .first()
    .getByRole("checkbox", { name: /Long run/ })
    .first();
  await firstLong.uncheck();
  await expect(plan.getByRole("button", { name: /Accept \d+ selected/ })).toBeVisible();
  await plan.getByRole("button", { name: /Accept \d+ selected/ }).click();
  // The proposal leaves the list once decided; its outcome moves to "Recent decisions".
  await expect(plan).toHaveCount(0);
  await page.getByText("Recent decisions").click();
  await expect(page.getByText(/-week 10K plan: Accepted \(\d+ of \d+ changes\)/)).toBeVisible();
  const { data: added } = await admin
    .from("scheduled_workouts")
    .select("title, race_goal_id, details")
    .eq("user_id", uid)
    .eq("planned_by", "scheduler");
  expect(added!.length).toBeGreaterThan(20);
  expect(added!.every((w) => w.race_goal_id)).toBe(true);
  expect(added!.some((w) => w.title.startsWith("Race: Spec City 10K"))).toBe(true);

  // The missed easy run: let go, not made up.
  await page.goto("/training");
  const missedSection = page.getByRole("region", { name: "Sessions that didn't happen" });
  await missedSection.getByRole("button", { name: "Plan around it" }).click();
  const proposal = page.getByRole("article", { name: "Missed: Easy run" });
  await expect(proposal.getByText("No need to make this up")).toBeVisible();
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(proposal).toHaveCount(0);
  await expect
    .poll(
      async () => (await admin.from("scheduled_workouts").select("status").eq("id", missed.id).single()).data?.status,
    )
    .toBe("missed");
  await expect(missedSection.getByText("No planned sessions from the last two weeks are left open.")).toBeVisible();

  // Tools.
  await page.goto("/training/pace");
  await page.getByLabel("Distance (km)").fill("10");
  await page.getByLabel("Time (h:mm:ss or mm:ss)").fill("50:00");
  await expect(page.getByText(/10.00 km in 50:00 at 5:00 \/km/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText("50:00");
  await page.goto("/training/sessions");
  await page.getByLabel("Session").selectOption("intervals");
  await page.getByLabel("Level").selectOption("regular");
  await expect(page.getByText(/Intervals: 6 × 800 m/)).toBeVisible();
  await expect(page.getByText(/Paces from your 5K estimate/)).toBeVisible();
});
