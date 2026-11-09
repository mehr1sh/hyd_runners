import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Storytelling: recap, reflections with suggestions, poster themes, Wrapped and the monthly poster. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner tells the story of a run and sees their year", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const ids: Record<string, string> = {};
  for (const k of ["a", "b"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `e2e-st-${k}-${stamp}@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `Story ${k}${stamp}` },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  const start = new Date(Date.now() - 86_400_000);
  const { data: act, error } = await admin
    .from("activities")
    .insert({
      user_id: ids.a,
      activity_type: "run",
      name: `Lake story ${stamp}`,
      visibility: "public",
      status: "ready",
      source_format: "gpx",
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 3000_000).toISOString(),
      elapsed_seconds: 3000,
      moving_seconds: 3000,
      moving_source: "derived",
      distance_m: 10000,
      avg_pace_s: 300,
      has_gps: true,
      elevation_profile: [
        [0, 500],
        [5000, 520],
        [10000, 505],
      ],
      km_splits: [{ index: 1, meters: 1000, seconds: 300, pace: 300, partial: false }],
      public_path: "SRID=4326;LINESTRING(78.42 17.42,78.43 17.425,78.44 17.42,78.45 17.43)",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await signInAs(page, `e2e-st-a-${stamp}@example.test`);
  await page.goto(`/activities/${act.id}`);
  await expect(page.getByRole("img", { name: "Animated route recap" })).toBeVisible();
  await page.getByRole("button", { name: "Play recap" }).click();
  await page.getByLabel("What did you enjoy?").fill("Sunrise over the lake");
  await page.getByLabel("Who did you run with?").fill("Asha");
  const suggestion = page.getByRole("button", {
    name: /^10\.00 km run in 50:00 with Asha\. Best bit: sunrise over the lake\.$/,
  });
  await suggestion.click();
  await expect(page.getByRole("textbox", { name: "Your story" })).toHaveValue(
    "10.00 km run in 50:00 with Asha. Best bit: sunrise over the lake.",
  );
  await page.getByRole("checkbox", { name: /Show my story/ }).check();
  await page.getByRole("region", { name: "Your story" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved\. Your story shows/)).toBeVisible();

  const neon = await page.request.get(`/api/v1/activities/${act.id}/card?format=square&theme=neon`);
  expect(neon.status()).toBe(200);
  expect(neon.headers()["content-type"]).toContain("image/png");
  const elevation = await page.request.get(`/api/v1/activities/${act.id}/card?format=story&theme=elevation`);
  expect(elevation.status()).toBe(200);

  await page.goto("/wrapped");
  await expect(page.getByRole("region", { name: /in numbers/ })).toContainText("10.00 km");
  await expect(page.getByText(/Longest run/)).toBeVisible();
  const month = start.toISOString().slice(0, 7);
  const poster = await page.request.get(`/api/v1/me/poster?month=${month}&theme=neon`);
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toContain("image/png");
  expect((await page.request.get("/api/v1/me/poster?month=nope")).status()).toBe(422);

  // Another runner sees the shared story on the public activity.
  await signInAs(page, `e2e-st-b-${stamp}@example.test`);
  await page.goto(`/activities/${act.id}`);
  await expect(page.getByRole("region", { name: "The runner's story" })).toContainText(
    "Best bit: sunrise over the lake.",
  );
  expect((await page.request.get(`/api/v1/activities/${act.id}/card?theme=neon`)).status()).toBe(404);
});
