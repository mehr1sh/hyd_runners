import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Marketplace: a verified coach lists a service and time; a runner books after acknowledging the boundaries. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("a runner books a verified coach; payments stay off", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const people = { p: `Coach Market${stamp}`, r: `Runner Market${stamp}`, a: `Admin Market${stamp}` };
  const ids: Record<string, string> = {};
  for (const k of ["p", "r", "a"] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `e2e-mk-${k}-${stamp}@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: people[k] },
    });
    if (error) throw new Error(error.message);
    ids[k] = data.user.id;
  }
  await admin.from("user_roles").insert([
    { user_id: ids.p, role: "coach" },
    { user_id: ids.a, role: "admin" },
  ]);

  // Coach: profile, review request, admin verifies.
  await signInAs(page, `e2e-mk-p-${stamp}@example.test`);
  await page.goto("/coach/profile");
  await page.getByLabel("Headline").fill("Form and race coach");
  await page.getByLabel("Credential 1 name").fill("Level 3 Running Coach");
  await page.getByRole("checkbox", { name: "Show my profile to runners" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(/Profile saved/)).toBeVisible();
  await page.getByRole("button", { name: "Request verification" }).click();
  await expect(page.getByText("Verification pending", { exact: true })).toBeVisible();

  await page.goto("/coach/services");
  await page.getByLabel("Title").fill("Running form review");
  await page.getByLabel("Type").selectOption("form_review");
  await page.getByLabel(/Indicative fee/).fill("1500");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText(/Service added/)).toBeVisible();
  await page.getByLabel("Date").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel("Where (optional)").fill("KBR Park gate 1");
  await page.getByRole("button", { name: "Add open time" }).click();
  await expect(page.getByText("Time added.")).toBeVisible();

  // Not listed until verified.
  await signInAs(page, `e2e-mk-r-${stamp}@example.test`);
  await page.goto("/professionals");
  await expect(page.getByText(people.p)).toHaveCount(0);

  await signInAs(page, `e2e-mk-a-${stamp}@example.test`);
  await page.goto("/manager/professionals");
  const pending = page
    .getByRole("region", { name: /Waiting for review/ })
    .getByRole("listitem")
    .filter({ hasText: people.p });
  await pending.getByLabel(/How you checked/).fill("Checked coaching licence register");
  await pending.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByRole("region", { name: "All profiles" })).toContainText(people.p);

  // Runner books.
  await signInAs(page, `e2e-mk-r-${stamp}@example.test`);
  await page.goto("/professionals");
  await page.getByRole("link", { name: people.p }).click();
  await expect(page.getByText(/about ₹1500, paid directly/)).toBeVisible();
  await page.getByLabel(/What would you like help with/).fill("Cadence and arm swing");
  // The acknowledgement is required before the form can be sent (and re-checked by the database).
  await expect(page.getByRole("checkbox", { name: /I've read this/ })).toHaveAttribute("required", "");
  await page.getByRole("checkbox", { name: /I've read this/ }).check();
  await page.getByRole("button", { name: "Request booking" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Running form review" })).toContainText(
    "Waiting for confirmation",
  );

  // Coach confirms; runner sees it, with payments clearly off.
  await signInAs(page, `e2e-mk-p-${stamp}@example.test`);
  await page.goto("/coach/services");
  const req = page.getByRole("list", { name: "Booking requests" }).getByRole("listitem").filter({ hasText: people.r });
  await expect(req).toContainText("Cadence and arm swing");
  await req.getByRole("button", { name: "Confirm" }).click();
  await expect(req).toContainText("Confirmed");

  await signInAs(page, `e2e-mk-r-${stamp}@example.test`);
  await page.goto("/bookings");
  await expect(page.getByText(/Payments are not enabled/)).toBeVisible();
  const booking = page.getByRole("list", { name: "Bookings" }).getByRole("listitem").first();
  await expect(booking).toContainText("Confirmed");
  await booking.getByRole("button", { name: "Cancel booking" }).click();
  await expect(booking).toContainText("Cancelled by the runner");
});
