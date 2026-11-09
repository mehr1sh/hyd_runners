import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Matching and squads: opt-in matches with reasons, creating a squad, inviting a match, chat, calendar and leaving. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("runners opt into matching, form a squad and run it together", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const names = { a: `Ayaan Squad${stamp}`, b: `Bina Squad${stamp}` };
  const emails = { a: `e2e-sq-a-${stamp}@example.test`, b: `e2e-sq-b-${stamp}@example.test` };
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
  // B is already opted in with a distinctive area so the match is deterministic.
  await admin.from("matching_profiles").insert({
    user_id: ids.b,
    opted_in: true,
    pace_min_s: 345,
    pace_max_s: 390,
    typical_km: 6,
    areas: ["shamshabad"],
    days: [2, 6],
    times: ["early_morning"],
    goals: ["consistency"],
    intro: `Easy Saturday runs ${stamp}`,
  });

  await signInAs(page, emails.a);
  await page.goto("/matching");
  await expect(page.getByText(/Turn on matching/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Show me in runner matching/ }).check();
  await page.getByLabel("Easy pace from (min/km)").fill("5:50");
  await page.getByLabel("to (min/km)").fill("6:30");
  await page.getByLabel("Typical run (km)").fill("6");
  await page.getByRole("checkbox", { name: "Shamshabad" }).check();
  await page.getByRole("checkbox", { name: "Sat" }).check();
  await page.getByRole("checkbox", { name: "Early morning" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  const match = page.getByRole("list", { name: "Matches" }).getByRole("listitem").filter({ hasText: names.b });
  await expect(match).toBeVisible();
  await expect(match.getByText("Similar pace")).toBeVisible();
  await expect(match.getByText("Runs in the same area")).toBeVisible();
  await expect(match.getByText("Both run around Shamshabad")).toBeVisible();

  // Create a squad, then invite the match.
  await page.goto("/squads");
  await page.getByLabel("Squad name").fill(`Airport Dawn ${stamp}`);
  await page.getByLabel("Weekly distance target, km (optional)").fill("20");
  await page.getByRole("button", { name: "Create squad" }).click();
  await expect(page.getByRole("heading", { name: `Airport Dawn ${stamp}` })).toBeVisible();
  const squadUrl = page.url();
  await page.goto("/matching");
  await match.getByRole("button", { name: "Invite to squad" }).click();
  await expect(match.getByText("Invitation sent.")).toBeVisible();

  // B joins, chats and adds a run.
  await signInAs(page, emails.b);
  await page.goto("/squads");
  await page.getByRole("region", { name: "Invitations" }).getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("link", { name: `Airport Dawn ${stamp}` })).toBeVisible();
  await page.goto(squadUrl);
  await page.getByPlaceholder("Message the squad").fill("Saturday 6am at the gate?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("list", { name: "Squad messages" })).toContainText("Saturday 6am at the gate?");
  await page.getByLabel("Run", { exact: true }).fill("Saturday loop");
  await page.getByLabel("Meeting point").fill("Main gate, public park");
  await page.getByLabel("Date").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Add to calendar" }).click();
  await expect(page.getByText(/Saturday loop ·/)).toBeVisible();
  await page.getByRole("button", { name: "I'm going" }).click();
  await expect(page.getByText(/1 going/)).toBeVisible();
  await expect(page.getByRole("region", { name: /Members \(2 of 6\)/ })).toBeVisible();

  // A sees it; an outsider cannot.
  await signInAs(page, emails.a);
  await page.goto(squadUrl);
  await expect(page.getByRole("list", { name: "Squad messages" })).toContainText("Saturday 6am at the gate?");
  await expect(page.getByRole("list", { name: "Squad messages" })).toContainText(names.b);
  await expect(page.getByRole("region", { name: /Members \(2 of 6\)/ })).toContainText(names.b);
  await expect(page.getByRole("region", { name: "This week together" })).toContainText(names.b);
  await expect(page.getByRole("region", { name: "This week together" })).toContainText("of 20 km target");

  const { data: outsider } = await admin.auth.admin.createUser({
    email: `e2e-sq-o-${stamp}@example.test`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Outsider ${stamp}` },
  });
  expect(outsider.user).toBeTruthy();
  await signInAs(page, `e2e-sq-o-${stamp}@example.test`);
  await page.goto(squadUrl);
  await expect(page.getByText("Saturday 6am at the gate?")).toHaveCount(0);
});
