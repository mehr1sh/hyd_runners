import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Coach platform: assigned runners, notes and replies, proposals the runner accepts, sharing switch, verification. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a coach reviews an assigned runner, gives feedback and proposes a change the runner accepts", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const people = { r: `Rhea Coached${stamp}`, c: `Coach Kiran${stamp}`, a: `Admin Asha${stamp}` };
  const emails = {
    r: `e2e-cp-r-${stamp}@example.test`,
    c: `e2e-cp-c-${stamp}@example.test`,
    a: `e2e-cp-a-${stamp}@example.test`,
  };
  const ids: Record<string, string> = {};
  for (const k of ["r", "c", "a"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emails[k],
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: people[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  await admin.from("user_roles").insert([
    { user_id: ids.c, role: "coach" },
    { user_id: ids.a, role: "admin" },
  ]);
  await admin.from("coach_assignments").insert({ coach_id: ids.c, runner_id: ids.r });
  const start = new Date(Date.now() - 2 * 86_400_000);
  await admin.from("activities").insert({
    user_id: ids.r,
    activity_type: "run",
    status: "ready",
    source_format: "gpx",
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + 2400_000).toISOString(),
    elapsed_seconds: 2400,
    moving_seconds: 2400,
    moving_source: "derived",
    distance_m: 7000,
    avg_pace_s: 343,
    has_gps: false,
  });
  const when = new Date(Date.now() + 3 * 86_400_000);
  const { data: session } = await admin
    .from("scheduled_workouts")
    .insert({
      user_id: ids.r,
      title: "Long run",
      workout_type: "run",
      starts_at: when.toISOString(),
      duration_minutes: 80,
      planned_by: "runner",
    })
    .select("id")
    .single();

  // Coach: list, detail, note, proposal.
  await signInAs(page, emails.c);
  await page.goto("/coach");
  await page.getByRole("link", { name: people.r }).click();
  await expect(page.getByRole("heading", { name: people.r })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent activities" })).toContainText("7.00 km");
  await page.getByLabel("Type", { exact: true }).selectOption("workout_feedback");
  await page.getByLabel("Message to your runner").fill("Lovely controlled run on Saturday.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Lovely controlled run on Saturday.")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Shorter long run this week");
  await page.getByLabel("Why").fill("You have exams this week");
  await page.getByLabel(/Shorten .*Long run/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Propose to runner" }).click();
  await expect(page.getByText(/Shorter long run this week · yours · proposed/)).toBeVisible();

  // Runner: notification, reply, accept.
  await signInAs(page, emails.r);
  await page.goto("/notifications");
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "Your coach left feedback on a session",
  );
  await page.goto("/training");
  const coach = page.getByRole("region", { name: "Your coach" });
  await expect(coach).toContainText("Lovely controlled run on Saturday.");
  await coach.getByPlaceholder("Write a reply").fill("Thank you!");
  await coach.getByRole("button", { name: "Reply" }).click();
  await expect(coach.getByText("You: Thank you!")).toBeVisible();
  const proposal = page.getByRole("article", { name: "Shorter long run this week" });
  await expect(proposal.getByText("From your coach")).toBeVisible();
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(proposal).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await admin.from("scheduled_workouts").select("duration_minutes").eq("id", session!.id).single()).data
          ?.duration_minutes,
    )
    .toBeLessThan(80);

  // Runner turns sharing off; the coach sees that.
  await coach.getByRole("checkbox", { name: /Let my assigned coach see/ }).uncheck();
  await coach.getByRole("button", { name: "Save sharing choice" }).click();
  await expect
    .poll(
      async () =>
        (await admin.from("profiles").select("coach_sees_training").eq("id", ids.r).single()).data?.coach_sees_training,
    )
    .toBe(false);

  await signInAs(page, emails.c);
  await page.goto(`/coach/runners/${ids.r}`);
  await expect(page.getByText(/has turned off training sharing/)).toBeVisible();
  await expect(page.getByText(/Shorter long run this week · yours · accepted/)).toBeVisible();
  await expect(page.getByText(`${people.r}: Thank you!`)).toBeVisible();

  // Professional profile and admin verification.
  await page.goto("/coach/profile");
  await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
  await page.getByLabel("Headline").fill("Distance coach, Hyderabad");
  await page.getByLabel("Credential 1 name").fill("Level 2 Endurance Coach");
  await page.getByLabel("Credential 1 issuer").fill("National athletics body");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(/Profile saved/)).toBeVisible();
  await page.getByRole("button", { name: "Request verification" }).click();
  await expect(page.getByText("Verification pending", { exact: true })).toBeVisible();

  await signInAs(page, emails.a);
  await page.goto("/manager/professionals");
  const pending = page
    .getByRole("region", { name: /Waiting for review/ })
    .getByRole("listitem")
    .filter({ hasText: people.c });
  await pending.getByLabel(/How you checked/).fill("Checked licence register");
  await pending.getByRole("button", { name: "Save decision" }).click();
  await expect(
    page.getByRole("region", { name: "All profiles" }).getByRole("listitem").filter({ hasText: people.c }),
  ).toContainText("Verified");

  // The runner cannot open the coach pages.
  await signInAs(page, emails.r);
  await page.goto(`/coach/runners/${ids.r}`);
  await expect(page.getByText("The coach area is for staff")).toBeVisible();
});
