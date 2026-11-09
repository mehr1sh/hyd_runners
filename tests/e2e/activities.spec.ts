import { expect, test, type Page } from "@playwright/test";
import { fit, gpx, track } from "../unit/activities/fixtures";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** GPX/FIT import through the browser: upload, processing, details, privacy, duplicates, history. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner imports GPX and FIT files and sees splits, records and privacy controls", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e-act-${stamp}@example.test`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Act ${stamp}` },
  });
  if (error) throw new Error(error.message);
  await signInAs(page, email);

  await page.goto("/activities");
  await expect(page.getByText("No imported activities yet")).toBeVisible();

  // 3.2 m/s for 28 minutes ≈ 5.4 km.
  const gpxText = gpx(
    track({ start: new Date("2026-11-02T00:40:00Z"), seconds: 1680, speedMs: 3.2, ele: (i) => 520 + (i % 30) }),
  );
  await page.getByRole("link", { name: "Import an activity" }).click();
  await page
    .getByLabel("GPX or FIT file (up to 15 MB)")
    .setInputFiles({ name: "morning.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpxText) });
  await page.getByLabel("Name (optional)").fill(`Dawn 5K ${stamp}`);
  await page.getByRole("button", { name: "Import activity" }).click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: `Dawn 5K ${stamp}` })).toBeVisible();
  await expect(
    page.getByText("5.38 km").or(page.getByText("5.37 km")).or(page.getByText("5.39 km")).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kilometre splits" })).toBeVisible();
  await expect(page.getByText("· fastest").first()).toBeVisible();
  await expect(page.getByText(/^5 km: /)).toBeVisible();
  await expect(page.getByText("Measured from your GPS track, not an official race result.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Elevation from/ })).toBeVisible();
  await page.getByLabel("Who can see it").selectOption("public");
  await page.getByLabel("Hide the start and end of the route from others").selectOption("500");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Share cards: rendered for the owner as PNG, at the requested size.
  const activityId = new URL(page.url()).pathname.split("/").pop()!;
  const preview = page.getByRole("img", { name: "Preview of your share card" });
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBe(1080);
  await page.getByLabel("Format").selectOption("story");
  await page.getByLabel("Show pace").uncheck();
  await expect(preview).toHaveAttribute("src", `/api/v1/activities/${activityId}/card?format=story&pace=0`);
  const card = await page.request.get(`/api/v1/activities/${activityId}/card?format=story&pace=0`);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  expect(card.headers()["cache-control"]).toContain("no-store");
  const png = await card.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);

  // The same file again is caught as a duplicate.
  await page.goto("/activities/import");
  await page
    .getByLabel("GPX or FIT file (up to 15 MB)")
    .setInputFiles({ name: "again.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpxText) });
  await page.getByRole("button", { name: "Import activity" }).click();
  await expect(page.getByText("You have already imported this activity.")).toBeVisible({ timeout: 20_000 });

  // A FIT file of a different walk.
  const fitBytes = fit(track({ start: new Date("2026-11-03T12:00:00Z"), seconds: 1200, speedMs: 1.4 }), { sport: 11 });
  await page.goto("/activities/import");
  await page
    .getByLabel("GPX or FIT file (up to 15 MB)")
    .setInputFiles({ name: "walk.fit", mimeType: "application/octet-stream", buffer: Buffer.from(fitBytes) });
  await page.getByLabel("Activity", { exact: true }).selectOption("walk");
  await page.getByRole("button", { name: "Import activity" }).click();
  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText("FIT import")).toBeVisible();

  // A broken file gets a clear reason.
  await page.goto("/activities/import");
  await page
    .getByLabel("GPX or FIT file (up to 15 MB)")
    .setInputFiles({ name: "notes.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from("not a gpx file") });
  await page.getByRole("button", { name: "Import activity" }).click();
  await expect(page.getByText("Upload a GPX or FIT activity file.")).toBeVisible({ timeout: 20_000 });

  await page.goto("/activities");
  const list = page.getByRole("list", { name: "Activities" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.goto("/activities?type=walk");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Another runner cannot render a card for it, even though it is public; nor can a signed-out visitor.
  const otherEmail = `e2e-act-other-${stamp}@example.test`;
  const other = await admin.auth.admin.createUser({ email: otherEmail, password: PASSWORD, email_confirm: true });
  if (other.error) throw new Error(other.error.message);
  await signInAs(page, otherEmail);
  expect((await page.request.get(`/api/v1/activities/${activityId}/card`)).status()).toBe(404);
  await page.context().clearCookies();
  expect((await page.request.get(`/api/v1/activities/${activityId}/card`)).status()).toBe(401);
});
