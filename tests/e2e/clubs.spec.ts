import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Clubs: creation, join requests and approval, announcements, club runs and invite links. */
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

test("a club grows through requests and invite links", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const clubName = `Dawn Runners ${stamp}`;
  const emails = {
    manager: `e2e-club-manager-${stamp}@example.test`,
    runner: `e2e-club-runner-${stamp}@example.test`,
    invited: `e2e-club-invited-${stamp}@example.test`,
  };
  await createUser(admin, emails.manager, `Club Manager ${stamp}`, ["programme_manager"]);
  await createUser(admin, emails.runner, `Club Runner ${stamp}`);
  await createUser(admin, emails.invited, `Club Invited ${stamp}`);

  // The manager creates the club and becomes its first admin.
  await signInAs(page, emails.manager);
  await page.goto("/clubs");
  await page.getByLabel("Club name").fill(clubName);
  await page.getByLabel("Area (optional)").fill("Jubilee Hills");
  await page.getByLabel("Who can join").selectOption("request");
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/dawn-runners-[a-z0-9-]+\/manage$/);
  const clubPath = new URL(page.url()).pathname.replace(/\/manage$/, "");
  await page.getByRole("tab", { name: "Announcements" }).click();
  await page.getByLabel("Announcement title").fill("Sunday long run");
  await page.getByLabel("Message to members").fill("Meet at the north gate at 5:45.");
  await page.getByRole("button", { name: "Post to members" }).click();
  await expect(page.getByText("Announcement posted.")).toBeVisible();
  await page.getByRole("tab", { name: "Club runs" }).click();
  await page.getByLabel("Title").fill(`Club loop ${stamp}`);
  await page.getByLabel("Starts").fill("2030-01-05T06:00");
  await page.getByLabel("Ends").fill("2030-01-05T07:00");
  await page.getByLabel("Status").selectOption("published");
  await page
    .getByRole("button", { name: /Save event|Create event|Save/ })
    .first()
    .click();
  await expect(page.getByText("Event saved.")).toBeVisible();

  // A runner asks to join; until approved they see no announcements.
  await signInAs(page, emails.runner);
  await page.goto("/clubs");
  await page.getByLabel("Search clubs").fill(clubName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: clubName }).click();
  await expect(page.getByText(`Club loop ${stamp}`)).toBeVisible();
  await page.getByRole("button", { name: "Ask to join" }).click();
  await expect(page.getByRole("button", { name: "Withdraw request" })).toBeVisible();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Sunday long run")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // The admin approves and creates an invite link.
  await signInAs(page, emails.manager);
  await page.goto(`${clubPath}/manage`);
  await page.getByRole("list", { name: "Join requests" }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("No requests waiting.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Members" })).toContainText(`Club Runner ${stamp}`);
  await page.getByRole("tab", { name: "Invites" }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Invite link created.")).toBeVisible();
  const inviteText = await page.getByRole("list", { name: "Invite links" }).locator(".font-mono").first().innerText();
  const invitePath = new URL(inviteText).pathname;

  // The approved runner now sees members-only content.
  await signInAs(page, emails.runner);
  await page.goto(clubPath);
  await expect(page.getByText("Sunday long run")).toBeVisible();
  await expect(page.getByText("This week in the club")).toBeVisible();
  await page.goto(`${clubPath}/manage`);
  await expect(page.getByText("Club management is for staff")).toBeVisible();

  // Someone with the invite link joins directly.
  await signInAs(page, emails.invited);
  await page.goto(invitePath);
  await page.getByRole("button", { name: "Join the club" }).click();
  await expect(page).toHaveURL(new RegExp(`${clubPath}$`));
  await expect(page.getByText("Meet at the north gate at 5:45.")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
