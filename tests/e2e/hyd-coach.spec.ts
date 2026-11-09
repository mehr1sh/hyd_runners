import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** HYD Coach: grounded answers from the runner's own activities, safety replies, privacy and deletion. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner asks HYD Coach about their running and gets answers grounded in their data", async ({
  page,
}, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const emails = { a: `e2e-hc-a-${stamp}@example.test`, b: `e2e-hc-b-${stamp}@example.test` };
  const ids: Record<string, string> = {};
  for (const k of ["a", "b"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emails[k],
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `Coach Spec ${k.toUpperCase()}${stamp}` },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  // Three 6 km runs a week for twelve weeks; the last six weeks at 5:30 /km, the six before at 5:50 /km.
  const rows = [];
  for (let d = 1; d < 84; d++) {
    if (d % 7 !== 1 && d % 7 !== 3 && d % 7 !== 5) continue;
    const pace = d < 42 ? 330 : 350;
    const start = new Date(Date.now() - d * 86_400_000);
    start.setUTCHours(1, 0, 0, 0);
    rows.push({
      user_id: ids.a,
      activity_type: "run",
      name: `Coach spec run ${d}`,
      status: "ready",
      source_format: "gpx",
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 6 * pace * 1000).toISOString(),
      elapsed_seconds: 6 * pace,
      moving_seconds: 6 * pace,
      moving_source: "derived",
      distance_m: 6000,
      avg_pace_s: pace,
      has_gps: false,
    });
  }
  const { error: insertError } = await admin.from("activities").insert(rows);
  if (insertError) throw new Error(insertError.message);

  await signInAs(page, emails.a);
  await page.goto("/hyd-coach");
  await expect(page.getByRole("heading", { name: "HYD Coach" })).toBeVisible();
  await page.getByRole("button", { name: "Am I getting faster?" }).click();

  const latest = page.locator("#latest");
  await expect(latest).toContainText("Yes, on average");
  await expect(latest).toContainText("5:30 /km");
  await expect(latest).toContainText("5:50 /km");
  await expect(latest.getByText("Calculated from your data")).toBeVisible();
  await latest.getByText(/What this is based on/).click();
  await expect(latest.getByText("Average pace, last 6 weeks")).toBeVisible();
  const conversationUrl = page.url();

  // A follow-up in the same conversation.
  await page.getByLabel("Ask HYD Coach").fill("How consistent have I been?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator("#latest")).toContainText("You ran in 12 of 12 weeks");
  await expect(page.getByRole("list", { name: "Messages" }).locator(":scope > li")).toHaveCount(4);

  // Pain gets professional-assessment guidance, never a diagnosis.
  await page.getByLabel("Ask HYD Coach").fill("My knee hurts after long runs, what is wrong with it?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator("#latest")).toContainText("doctor or physiotherapist");
  await expect(page.locator("#latest").getByText("Safety guidance")).toBeVisible();

  // Another runner cannot open the conversation.
  await signInAs(page, emails.b);
  await page.goto(conversationUrl.replace(/#.*/, ""));
  await expect(page.getByText("Conversation not found")).toBeVisible();
  await expect(page.getByText("5:30 /km")).toHaveCount(0);

  // With no activities, the coach says so instead of guessing.
  await page.goto("/hyd-coach");
  await page.getByRole("button", { name: "Am I getting faster?" }).click();
  await expect(page.locator("#latest")).toContainText("No run or walk-run activities in the last 120 days");

  // The owner deletes the conversation.
  await signInAs(page, emails.a);
  await page.goto(conversationUrl.replace(/#.*/, ""));
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await expect(page).toHaveURL(/\/hyd-coach$/);
  await page.goto(conversationUrl.replace(/#.*/, ""));
  await expect(page.getByText("Conversation not found")).toBeVisible();
});
