import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Race Passport: event race with QR check-in, partners, checklist and organiser-verified results. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner prepares for a race, checks in with a QR code and gets an organiser-verified result", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const people = { a: `Passport A${stamp}`, b: `Passport B${stamp}`, o: `Organiser P${stamp}` };
  const ids: Record<string, string> = {};
  for (const k of ["a", "b", "o"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `e2e-pp-${k}-${stamp}@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: people[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  const starts = new Date(Date.now() + 60 * 60_000);
  const { data: ev, error: evError } = await admin
    .from("events")
    .insert({
      title: `Lakes 10K ${stamp}`,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 2 * 3_600_000).toISOString(),
      status: "published",
    })
    .select("id")
    .single();
  if (evError) throw new Error(evError.message);
  await admin.from("event_team").insert({ event_id: ev.id, user_id: ids.o, role: "organiser" });
  for (const k of ["a", "b"] as const) {
    const { error } = await admin.from("event_rsvps").insert({ event_id: ev.id, user_id: ids[k], status: "going" });
    if (error) throw new Error(error.message);
  }
  const date = starts.toISOString().slice(0, 10);
  // B is already in the passport and open to partners with a similar target.
  await admin.from("race_entries").insert({
    user_id: ids.b,
    event_id: ev.id,
    name: `Lakes 10K ${stamp}`,
    race_date: date,
    distance: "10k",
    distance_m: 10000,
    target_seconds: 3100,
    find_partners: true,
  });

  await signInAs(page, `e2e-pp-a-${stamp}@example.test`);
  await page.goto("/passport");
  const fromEvents = page.getByRole("region", { name: "From your HYD Runners events" });
  await fromEvents.getByRole("button", { name: "Add to passport" }).first().click();
  await expect(page.getByRole("heading", { name: `Lakes 10K ${stamp}` })).toBeVisible();
  await expect(page.getByRole("img", { name: /Check-in code/ })).toBeVisible();

  const details = page.getByRole("region", { name: "Registration and logistics" });
  await details.getByLabel("Target time (optional)").fill("50:00");
  await details.getByLabel("Bib number").fill("A-1042");
  await details.getByLabel("Emergency contact name").fill("Asha");
  await details.getByLabel("Emergency contact phone").fill("+91 98765 43210");
  await details.getByRole("checkbox", { name: /Let other runners in this race/ }).check();
  await details.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: /Race-day details|Race day/ })).toContainText("A-1042");
  await expect(page.getByRole("list", { name: "Race partners" })).toContainText(people.b);

  await page.getByLabel("New checklist item").fill("Pick up bib at the expo");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pick up bib at the expo", exact: true })).toBeVisible();

  // The QR code links to the check-in page; a runner can't use it, the organiser can.
  const { data: rsvp } = await admin
    .from("event_rsvps")
    .select("checkin_token")
    .eq("event_id", ev.id)
    .eq("user_id", ids.a)
    .single();
  const checkInUrl = `/events/${ev.id}/check-in?token=${rsvp!.checkin_token}`;
  await page.goto(checkInUrl);
  await expect(page.getByText(/Only this event's organisers/)).toBeVisible();
  await signInAs(page, `e2e-pp-o-${stamp}@example.test`);
  await page.goto(checkInUrl);
  await page.getByRole("button", { name: "Check this runner in" }).click();
  await expect(page.getByText(`Checked in: ${people.a}`)).toBeVisible();

  // The organiser imports results; the runner sees them as verified.
  await page.goto(`/events/${ev.id}/manage`);
  await page.getByRole("tab", { name: "Race day" }).click();
  await page
    .getByLabel(/Paste results/)
    .fill(`user_id,outcome,time\n${ids.a}, finished, 49:12\nnot-a-user, finished, 1:00:00`);
  await page.getByRole("button", { name: "Import results" }).click();
  await expect(page.getByText(/Saved 1 result\. Skipped line 2/)).toBeVisible();

  await signInAs(page, `e2e-pp-a-${stamp}@example.test`);
  await page.goto("/passport");
  await page
    .getByRole("link", { name: `Lakes 10K ${stamp}` })
    .first()
    .click();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toContainText("49:12");
  await expect(result).toContainText("Verified by the organiser");
  await expect(page.getByRole("region", { name: /Race-day details|Race day/ })).toContainText("Checked in");
});
