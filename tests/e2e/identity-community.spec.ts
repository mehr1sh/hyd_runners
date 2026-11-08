import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/**
 * Onboarding, profile and the community feedback loop across runner, coach and
 * programme manager. Runs only when Supabase is configured. Staff accounts are
 * created with the local secret key because roles cannot be self-granted.
 */

// Writes accounts and data: never against the shared Production/Preview database.
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function createUser(admin: SupabaseClient, email: string, displayName: string, roles: string[] = []) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
  if (roles.length > 0) {
    const { error: roleError } = await admin
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: data.user.id, role })));
    if (roleError) throw new Error(`Could not grant roles to ${email}: ${roleError.message}`);
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

test.beforeEach(async ({ request }) => {
  const health = await (await request.get("/api/v1/health")).json();
  test.skip(!health.data.supabaseConfigured, "Supabase not configured");
});

test("a new runner completes onboarding, edits their profile and sends feedback", async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;

  await page.goto("/sign-up");
  await page.getByLabel(/what should we call you/i).fill("Onboarding Runner");
  await page.getByLabel("Email").fill(`e2e-onboard-${stamp}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  // Step 1: experience and difficulties (both can be selected).
  await page.getByLabel("New to running").check();
  await page.getByLabel("I struggle to stay consistent").check();
  await page.getByLabel("My timetable keeps changing").check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Step 2: training preferences.
  await page.getByLabel("Fitness goal").selectOption("first_5k");
  await page.getByLabel("Running", { exact: true }).check();
  await page.getByLabel("Monday", { exact: true }).check();
  await page.getByLabel("Thursday", { exact: true }).check();
  await page.getByLabel("Morning", { exact: true }).check();
  await page.getByLabel("Sessions per week").fill("3");
  await page.getByLabel(/typical session length/i).fill("30");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Step 3: places and in-app notification preferences, then finish.
  const places = page.getByRole("group", { name: "Preferred locations" });
  await expect(places).toBeVisible();
  const firstPlace = places.getByRole("checkbox").first();
  if (await firstPlace.count()) await firstPlace.check();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByText("Finish a first 5K")).toBeVisible();
  await expect(page.getByText("Consistency and a changing timetable").first()).toBeVisible();

  // Profile edits save without touching roles.
  await page.getByLabel("Name", { exact: true }).fill("Renamed Runner");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Renamed Runner");
  await expect(page.getByText("Runner", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Coming back to onboarding resumes at the finished state.
  await page.goto("/onboarding");
  await expect(page.getByText("Your setup is saved")).toBeVisible();

  // Participation feedback.
  const note = `Evening classes moved again (${stamp})`;
  await page.goto("/community");
  await page.getByRole("tab", { name: "Feedback" }).click();
  await page.getByLabel("What is getting in the way?").selectOption("schedule_conflicts");
  await page.getByLabel("Tell us more").fill(note);
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.getByText("Feedback submitted.")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: note });
  await expect(item).toContainText("Schedule conflicts");
  await expect(item).toContainText("New");
  await expectNoHorizontalScroll(page);
});

test("manager assigns feedback, coach replies and the runner sees it", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available to seed staff accounts");
  if (!admin) return;

  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const runnerName = `Runner ${stamp}`;
  const coachName = `Coach ${stamp}`;
  const emails = {
    manager: `e2e-manager-${stamp}@example.test`,
    coach: `e2e-coach-${stamp}@example.test`,
    runner: `e2e-runner-${stamp}@example.test`,
  };
  await createUser(admin, emails.manager, `Manager ${stamp}`, ["programme_manager"]);
  await createUser(admin, emails.coach, coachName, ["coach"]);
  await createUser(admin, emails.runner, runnerName);

  const note = `Struggling to keep going after week two (${stamp})`;
  const reply = `Let's drop to two shorter runs this week (${stamp})`;
  const announcement = `Saturday group run (${stamp})`;

  // Runner submits feedback through the UI.
  await signInAs(page, emails.runner);
  await page.goto("/community");
  await page.getByRole("tab", { name: "Feedback" }).click();
  await page.getByLabel("What is getting in the way?").selectOption("motivation");
  await page.getByLabel("Tell us more").fill(note);
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.getByText("Feedback submitted.")).toBeVisible();

  // Runners are kept out of staff areas.
  await page.goto("/coach");
  await expect(page.getByRole("heading", { name: /for staff/i })).toBeVisible();

  // Manager: announcement, coach assignment and feedback assignment.
  await signInAs(page, emails.manager);
  await page.goto("/manager");
  await page.locator("#announcement-title").fill(announcement);
  await page.locator("#announcement-body").fill("Meet at the north gate at 6:00.");
  await page.getByRole("button", { name: "Publish announcement" }).click();
  await expect(page.getByText("Announcement published.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("tab", { name: "People" }).click();
  await page.getByLabel("Coach or mentor").selectOption({ label: coachName });
  await page.getByLabel(/^Runner/).selectOption({ label: runnerName });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("Coach assigned.")).toBeVisible();
  await expect(page.getByText(`${coachName} → ${runnerName}`)).toBeVisible();

  await page.getByRole("tab", { name: "Feedback" }).click();
  const managed = page.getByRole("listitem").filter({ hasText: note });
  await managed.getByLabel("Assign").selectOption({ label: coachName });
  await managed.getByRole("button", { name: "Update" }).click();
  await expect(managed).toContainText(`Assigned to ${coachName}`);

  // The last of the six tabs stays reachable on a phone.
  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(page.getByText("Messages stay in the app. Email and push are not sent.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Coach: sees only assigned feedback (with the runner's name) and replies.
  await signInAs(page, emails.coach);
  await page.goto("/coach");
  const assigned = page.getByRole("listitem").filter({ hasText: note });
  await expect(assigned).toContainText(runnerName);
  await assigned.getByLabel("Reply").fill(reply);
  await assigned.getByRole("button", { name: "Send reply" }).click();
  await expect(assigned).toContainText(reply);
  await expect(assigned).toContainText("Acknowledged");
  await expectNoHorizontalScroll(page);

  // Runner: unread announcement can be marked read; the reply is visible.
  await signInAs(page, emails.runner);
  await page.goto("/community");
  await page.getByRole("tab", { name: "Announcements" }).click();
  const post = page.getByRole("listitem").filter({ hasText: announcement });
  await expect(post.getByText("Unread")).toBeVisible();
  await post.getByRole("button", { name: "Mark as read" }).click();
  await expect(post.getByText("Unread")).toHaveCount(0);

  await page.getByRole("tab", { name: "Feedback" }).click();
  const mine = page.getByRole("listitem").filter({ hasText: note });
  await expect(mine).toContainText(reply);
  await expect(mine).toContainText("Acknowledged");
});

test("a runner asks for a coach-led place and their coach approves it", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available to seed staff accounts");
  if (!admin) return;

  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const runnerName = `Applicant ${stamp}`;
  const emails = {
    coach: `e2e-approver-${stamp}@example.test`,
    runner: `e2e-applicant-${stamp}@example.test`,
  };
  const coachId = await createUser(admin, emails.coach, `Approver ${stamp}`, ["coach"]);
  const runnerId = await createUser(admin, emails.runner, runnerName);
  const { error } = await admin.from("coach_assignments").insert({ coach_id: coachId, runner_id: runnerId });
  if (error) throw new Error(`Could not assign the coach: ${error.message}`);

  // Runner asks for a place, changes their mind, then asks again.
  await signInAs(page, emails.runner);
  await page.goto("/programmes/training-and-shine");
  await page.getByRole("button", { name: "Request a place" }).click();
  await expect(page.getByText("Your request has been sent.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByRole("button", { name: "Request a place" })).toBeVisible();
  await page.getByRole("button", { name: "Request a place" }).click();
  await expect(page.getByText("Your request has been sent.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start session" })).toHaveCount(0);

  // Their coach approves it.
  await signInAs(page, emails.coach);
  await page.goto("/coach");
  const request = page.getByRole("listitem", { name: `${runnerName}: Training and Shine` });
  await expect(request).toBeVisible();
  await expectNoHorizontalScroll(page);
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(request).toHaveCount(0);
  await expect(page.getByText("No requests are waiting.")).toBeVisible();

  // The programme is now open to the runner.
  await signInAs(page, emails.runner);
  await page.goto("/programmes/training-and-shine");
  await expect(page.getByText("Your request has been sent.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
});
