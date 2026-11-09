import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Social v1: search, follow requests, followers-only visibility, feed, kudos, comments, reports and blocks. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/** Streaming pages render the not-found page (status may already be 200). */
async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "This page took a wrong turn" })).toBeVisible();
}

test("runners follow, see followers-only activity, give kudos and comment; a block cuts it off", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const names = { a: `Ananya Social${stamp}`, b: `Bharat Social${stamp}` };
  const emails = { a: `e2e-so-a-${stamp}@example.test`, b: `e2e-so-b-${stamp}@example.test` };
  const ids: Record<string, string> = {};
  for (const k of ["a", "b"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emails[k],
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: names[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  const runName = `Lakeside tempo ${stamp}`;
  const start = new Date(Date.now() - 2 * 86_400_000);
  const { data: act, error: actError } = await admin
    .from("activities")
    .insert({
      user_id: ids.a,
      activity_type: "run",
      name: runName,
      visibility: "followers",
      status: "ready",
      source_format: "gpx",
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 1800_000).toISOString(),
      elapsed_seconds: 1800,
      moving_seconds: 1800,
      moving_source: "derived",
      distance_m: 5000,
      avg_pace_s: 360,
      has_gps: true,
      public_path: "SRID=4326;LINESTRING(78.42 17.42,78.43 17.425,78.44 17.42)",
    })
    .select("id")
    .single();
  if (actError) throw new Error(actError.message);
  const activityPath = `/activities/${act.id}`;

  // B finds A and asks to follow; nothing is visible until A accepts.
  await signInAs(page, emails.b);
  await page.goto(`/runners?q=${encodeURIComponent(names.a)}`);
  await page.getByRole("list", { name: "Search results" }).getByRole("link", { name: names.a }).click();
  await expect(page.getByRole("heading", { name: names.a })).toBeVisible();
  await expect(page.getByText("Nothing shared with you yet.")).toBeVisible();
  await page.getByRole("button", { name: "Request to follow" }).click();
  await expect(page.getByRole("button", { name: "Cancel follow request" })).toBeVisible();
  await expect(page.getByText("Your follow request is waiting for approval.")).toBeVisible();
  await expectNotFound(page, activityPath);

  // A accepts.
  await signInAs(page, emails.a);
  await page.goto("/runners");
  const requests = page.getByRole("region", { name: "Follow requests" });
  await expect(requests).toContainText(names.b);
  await requests.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("region", { name: "Followers" })).toContainText(names.b);
  await expect(requests).not.toContainText(names.b);

  // B sees it in the feed, gives kudos and comments.
  await signInAs(page, emails.b);
  await page.goto("/feed");
  const item = page.getByRole("list", { name: "Feed" }).getByRole("listitem").filter({ hasText: runName });
  await expect(item).toContainText(names.a);
  await expect(item).toContainText(/· \d{1,2} [A-Z][a-z]{2} \d{4}/);
  await expect(item).not.toContainText(/\b(am|pm)\b/i); // date only, never the time of day
  await item.getByRole("button", { name: "Give kudos" }).click();
  await expect(item.getByRole("button", { name: "Remove kudos" })).toBeVisible();
  await expect(item).toContainText("1 kudos");
  await page.goto(activityPath);
  await expect(page.getByText(`By ${names.a}`)).toBeVisible();
  await expect(page.getByText("1 kudos")).toBeVisible();
  await page.getByLabel("Add a comment").fill("Lovely even pacing!");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Comments" })).toContainText("Lovely even pacing!");

  // A sees the comment with B's name, reports it, then blocks B.
  await signInAs(page, emails.a);
  await page.goto(activityPath);
  const comments = page.getByRole("list", { name: "Comments" });
  await expect(comments).toContainText(names.b);
  await comments.getByText("Report comment").click();
  await comments.getByLabel("Reason").selectOption("spam");
  await comments.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. A moderator will review it.")).toBeVisible();
  await page.goto(`/runners/${ids.b}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Block" }).click();
  await expect(page.getByText("You blocked this runner.")).toBeVisible();

  // B is cut off: no feed item, no activity, no profile, not in search.
  await signInAs(page, emails.b);
  await page.goto("/feed");
  await expect(page.getByText(runName)).toHaveCount(0);
  await expectNotFound(page, activityPath);
  await expectNotFound(page, `/runners/${ids.a}`);
  await page.goto(`/runners?q=${encodeURIComponent(names.a)}`);
  await expect(page.getByText("No runners found.", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
