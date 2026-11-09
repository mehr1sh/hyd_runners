import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Live group runs: opt-in sharing, captain view, help requests, stop; recap privacy; Run Radar. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner opts into live sharing, the captain sees them, help reaches the team and stopping removes the position", async ({
  browser,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const people = { k: `Captain Live${stamp}`, r: `Runner Live${stamp}` };
  const emails = { k: `e2e-lv-k-${stamp}@example.test`, r: `e2e-lv-r-${stamp}@example.test` };
  const ids: Record<string, string> = {};
  for (const k of ["k", "r"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emails[k],
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: people[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  const { data: loc } = await admin
    .from("locations")
    .insert({ name: `Live loop ${stamp}`, latitude: 17.4239, longitude: 78.4738 })
    .select("id")
    .single();
  const { data: ev, error: evError } = await admin
    .from("events")
    .insert({
      title: `Live test ${stamp}`,
      starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
      status: "published",
      location_id: loc!.id,
    })
    .select("id")
    .single();
  if (evError) throw new Error(evError.message);
  await admin.from("event_team").insert({ event_id: ev.id, user_id: ids.k, role: "captain" });
  await admin.from("event_rsvps").insert({ event_id: ev.id, user_id: ids.r, status: "going" });

  const captainCtx = await browser.newContext();
  const runnerCtx = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 17.4242, longitude: 78.4741, accuracy: 10 },
  });
  const captain = await captainCtx.newPage();
  const runner = await runnerCtx.newPage();

  await signInAs(captain, emails.k);
  await captain.goto(`/events/${ev.id}/live`);
  await captain.getByRole("button", { name: "Start live session" }).click();
  await expect(captain.getByRole("heading", { name: "Captain view" })).toBeVisible();
  await expect(captain.getByText("Nobody is sharing yet.")).toBeVisible();

  await signInAs(runner, emails.r);
  await runner.goto(`/events/${ev.id}`);
  await runner.getByRole("link", { name: /Live run/ }).click();
  await expect(runner.getByRole("heading", { name: "Your location is not shared" })).toBeVisible();
  await runner.getByLabel("Share for").selectOption("60");
  await runner.getByRole("button", { name: "Share my location for this run" }).click();
  await expect(runner.getByRole("heading", { name: "You're sharing your location" })).toBeVisible();
  await expect(runner.getByText(/GPS accuracy about 10 m/)).toBeVisible();
  await expect
    .poll(async () => (await admin.from("live_positions").select("user_id").eq("user_id", ids.r)).data?.length ?? 0)
    .toBe(1);

  await captain.reload();
  const row = captain.getByRole("row", { name: new RegExp(people.r) });
  await expect(row).toContainText("Live");

  await runner.getByLabel("What's wrong? (optional)").fill("Lost the group near the lake");
  await runner.getByRole("button", { name: "Ask the team for help" }).click();
  await expect(runner.getByText(/The team has been notified/)).toBeVisible();
  await captain.reload();
  await expect(captain.getByRole("list", { name: "Help requests" })).toContainText("Lost the group near the lake");
  await captain.getByRole("button", { name: "Mark resolved" }).click();
  await expect(captain.getByRole("list", { name: "Help requests" })).toHaveCount(0);

  await runner.getByRole("button", { name: "Stop sharing now" }).click();
  await expect(runner.getByRole("heading", { name: "Your location is not shared" })).toBeVisible();
  await expect
    .poll(async () => (await admin.from("live_positions").select("user_id").eq("user_id", ids.r)).data?.length ?? 0)
    .toBe(0);
  await captain.reload();
  await expect(captain.getByRole("row", { name: new RegExp(people.r) })).toContainText("Stopped sharing");

  // Run Radar lists upcoming runs at their meeting place.
  const { error: radarError } = await admin.from("events").insert({
    title: `Radar run ${stamp}`,
    starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(),
    status: "published",
    location_id: loc!.id,
    capacity: 12,
  });
  if (radarError) throw new Error(radarError.message);
  await runner.goto("/runs/radar");
  const radarItem = runner
    .getByRole("list", { name: "Upcoming group runs" })
    .getByRole("listitem")
    .filter({ hasText: `Radar run ${stamp}` });
  await expect(radarItem).toContainText(`Live loop ${stamp}`);
  await expect(radarItem).toContainText("12 of 12 spots open");

  await captain.getByRole("button", { name: "End live session" }).click();
  await expect(captain.getByText(/The live session has ended/)).toBeVisible();
  await captainCtx.close();
  await runnerCtx.close();
});

test("the group recap only shows distance with at least three recorded runs", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  // RSVPs are only accepted for upcoming runs: create it in the future, then move it into the past.
  const start = new Date(Date.now() - 26 * 3_600_000);
  const later = new Date(Date.now() + 86_400_000);
  const { data: ev } = await admin
    .from("events")
    .insert({
      title: `Recap ${stamp}`,
      starts_at: later.toISOString(),
      ends_at: new Date(later.getTime() + 3_600_000).toISOString(),
      status: "published",
    })
    .select("id")
    .single();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { data } = await admin.auth.admin.createUser({
      email: `e2e-rc${i}-${stamp}@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `Recap ${i} ${stamp}` },
    });
    ids.push(data.user!.id);
    const { error: rsvpError } = await admin
      .from("event_rsvps")
      .insert({ event_id: ev!.id, user_id: data.user!.id, status: "going" });
    if (rsvpError) throw new Error(rsvpError.message);
    await admin.from("activities").insert({
      user_id: data.user!.id,
      activity_type: "run",
      status: "ready",
      source_format: "gpx",
      started_at: new Date(start.getTime() + 60_000).toISOString(),
      ended_at: new Date(start.getTime() + 1_900_000).toISOString(),
      elapsed_seconds: 1800,
      moving_seconds: 1800,
      moving_source: "derived",
      distance_m: 5000,
      avg_pace_s: 360,
      has_gps: false,
    });
  }
  const { error: moveError } = await admin
    .from("events")
    .update({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString() })
    .eq("id", ev!.id);
  if (moveError) throw new Error(moveError.message);
  const { error: ciError } = await admin
    .from("event_rsvps")
    .update({ checked_in_at: start.toISOString() })
    .eq("event_id", ev!.id);
  if (ciError) throw new Error(ciError.message);
  await signInAs(page, `e2e-rc0-${stamp}@example.test`);
  await page.goto(`/events/${ev!.id}`);
  const recap = page.getByRole("region", { name: "Group recap" });
  await expect(recap).toContainText("3 checked in of 3 going");
  await expect(recap).toContainText("15.0 km together across 3 recorded runs");
  await admin.from("activities").delete().eq("user_id", ids[2]);
  await page.reload();
  await expect(recap).not.toContainText("km together");
});
