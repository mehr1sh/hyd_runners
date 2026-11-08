import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/**
 * Events v2: filters, event page, waiting list and promotion, pace groups,
 * organiser updates, check-in, results and calendar export.
 */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function createUser(admin: SupabaseClient, email: string, name: string, roles: string[] = []) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
  if (roles.length) {
    const { error: roleError } = await admin
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: data.user.id, role })));
    if (roleError) throw new Error(roleError.message);
  }
  return data.user.id;
}

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("waiting list, pace groups, organiser updates, check-in and results", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const title = `Sunrise beginners ${stamp}`;
  const emails = {
    manager: `e2e-ev-manager-${stamp}@example.test`,
    first: `e2e-ev-first-${stamp}@example.test`,
    second: `e2e-ev-second-${stamp}@example.test`,
  };
  await createUser(admin, emails.manager, `Ev Manager ${stamp}`, ["programme_manager"]);
  await createUser(admin, emails.first, `Ev First ${stamp}`);
  await createUser(admin, emails.second, `Ev Second ${stamp}`);
  // Starts within the hour so check-in is open.
  const { data: event, error } = await admin
    .from("events")
    .insert({
      title,
      description: "An easy loop for new runners.",
      starts_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      ends_at: new Date(Date.now() + 105 * 60_000).toISOString(),
      capacity: 1,
      status: "published",
      category: "beginner",
      meeting_point: "Main gate",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const eventPath = `/events/${event.id}`;

  // The organiser side: a pace group and an update.
  await signInAs(page, emails.manager);
  await page.goto(`${eventPath}/manage`);
  await page.getByRole("tab", { name: "Pace groups" }).click();
  await page.getByLabel("Pace group name").fill("Steady");
  await page.getByLabel("Fastest (min/km)").fill("6:00");
  await page.getByLabel("Slowest (min/km)").fill("6:30");
  await page.getByRole("button", { name: "Add pace group" }).click();
  await expect(page.getByRole("list", { name: "Pace groups" })).toContainText("6:00–6:30 min/km");
  await page.getByRole("tab", { name: "Updates" }).click();
  await page.getByLabel("Post an update to everyone on this event page").fill("Bring water, it's warm.");
  await page.getByRole("button", { name: "Post update" }).click();
  await expect(page.getByText("Update posted.")).toBeVisible();

  // First runner: finds it under Beginner friendly, takes the only place and picks a pace group.
  await signInAs(page, emails.first);
  await page.goto("/events?category=beginner");
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`${eventPath}$`));
  await expect(page.getByText("Meeting point: Main gate")).toBeVisible();
  await expect(page.getByText("Bring water, it's warm.")).toBeVisible();
  await expect(page.getByText(/Starts in/)).toBeVisible();
  await page.getByRole("button", { name: "I'm going" }).click();
  await expect(page.getByText("You're going!")).toBeVisible();
  await page.reload();
  await page.getByLabel("Your pace group").selectOption({ label: "Steady (6:00–6:30 min/km)" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Pace group saved.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  const calendar = await page.request.get(`${eventPath}/calendar`);
  expect(calendar.status()).toBe(200);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain(`SUMMARY:${title}`);

  // Second runner: the event is full, so they join the waiting list.
  await signInAs(page, emails.second);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(page.getByText(/You're on the waiting list/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("You're number 1 on the waiting list.")).toBeVisible();

  // The first runner cancels; the second is promoted automatically.
  await signInAs(page, emails.first);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "Cancel my place" }).click();
  await expect(page.getByText("RSVP cancelled.")).toBeVisible();
  await signInAs(page, emails.second);
  await page.goto(eventPath);
  await expect(page.getByRole("button", { name: "Cancel my place" })).toBeVisible();

  // The organiser checks them in and records a result.
  await signInAs(page, emails.manager);
  await page.goto(`${eventPath}/manage`);
  const row = page.getByRole("listitem", { name: `Ev Second ${stamp}` });
  await row.getByRole("button", { name: `Check in Ev Second ${stamp}` }).click();
  await expect(row.getByRole("button", { name: `Undo check-in for Ev Second ${stamp}` })).toBeVisible();
  await row.getByLabel("Time (optional)").fill("31:20");
  await row.getByRole("button", { name: "Save result" }).click();
  await expect(row).toContainText("Finished in 31:20");
  await expectNoHorizontalScroll(page);

  // The runner sees their own result and check-in.
  await signInAs(page, emails.second);
  await page.goto(eventPath);
  await expect(page.getByText("Checked in")).toBeVisible();
  await expect(page.getByText("Finished in 31:20")).toBeVisible();
});

test("runners cannot open another event's management page", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e-ev-nosy-${stamp}@example.test`;
  await createUser(admin, email, `Ev Nosy ${stamp}`);
  const { data: event, error } = await admin
    .from("events")
    .insert({
      title: `Locked ${stamp}`,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 90_000_000).toISOString(),
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await signInAs(page, email);
  await page.goto(`/events/${event.id}/manage`);
  await expect(page.getByText("Event management is for staff")).toBeVisible();
  await page.goto("/events?when=past");
  await expect(page.getByRole("tab", { name: "Past events" })).toHaveAttribute("aria-selected", "true");
});
