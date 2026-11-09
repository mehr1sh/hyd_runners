import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Routes: GPX upload, explorer, attributes and verification, reviews, condition reports, event link. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/** A ~1.1 km loop in Gachibowli with a 12 m climb. */
function gpxLoop() {
  const corners: [number, number, number][] = [
    [17.44, 78.35, 540],
    [17.4425, 78.35, 546],
    [17.4425, 78.3525, 552],
    [17.44, 78.3525, 546],
    [17.44, 78.35, 540],
  ];
  const pts: string[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      const [a, b] = [corners[i], corners[i + 1]];
      pts.push(
        `<trkpt lat="${(a[0] + (b[0] - a[0]) * t).toFixed(6)}" lon="${(a[1] + (b[1] - a[1]) * t).toFixed(6)}"><ele>${(a[2] + (b[2] - a[2]) * t).toFixed(1)}</ele></trkpt>`,
      );
    }
  }
  pts.push(`<trkpt lat="17.44" lon="78.35"><ele>540</ele></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" creator="e2e"><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

test("a manager uploads and verifies a route; runners review it and report conditions", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const name = `Stadium loop ${stamp}`;
  const emails = { manager: `e2e-rt-manager-${stamp}@example.test`, runner: `e2e-rt-runner-${stamp}@example.test` };
  for (const [key, email] of Object.entries(emails)) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `RT ${key} ${stamp}` },
    });
    if (error) throw new Error(error.message);
    if (key === "manager") await admin.from("user_roles").insert({ user_id: data.user.id, role: "programme_manager" });
  }

  await signInAs(page, emails.manager);
  await page.goto("/routes/new");
  await page.getByLabel("Route name").fill(name);
  await page.getByLabel("Area (optional)").fill("Gachibowli");
  await page
    .getByLabel("GPX file (up to 2.5 MB)")
    .setInputFiles({ name: "loop.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpxLoop()) });
  await page.getByLabel("Publish straight away").check();
  await page.getByRole("button", { name: "Upload route" }).click();
  await expect(page).toHaveURL(/\/routes\/stadium-loop-/);
  const routePath = new URL(page.url()).pathname;
  await expect(page.getByText("Loop", { exact: true })).toBeVisible();
  await expect(page.getByText("Not verified on the ground")).toBeVisible();
  await expect(page.getByRole("img", { name: /Elevation from 540 m to 552 m/ })).toBeVisible();
  await expect(page.getByText("Source: GPX upload")).toBeVisible();
  await page.getByLabel("Suits beginners").selectOption("yes");
  await page.getByLabel("Verified on the ground").check();
  await page.getByRole("button", { name: "Save route details" }).click();
  await expect(page.getByText("Route saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Verified on the ground ·/)).toBeVisible();

  await signInAs(page, emails.runner);
  await page.goto("/routes?beginner=1");
  await expect(page.getByRole("region", { name: "Map of routes" })).toBeVisible();
  await expect(page.getByRole("link", { name })).toBeVisible();

  // Natural-language search becomes visible, removable typed filters.
  await page.goto("/routes");
  await page.getByLabel("Describe the run you want").fill(`beginner friendly loop under 2 km ${stamp}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/We searched for: up to 2 km · loop · suits beginners · matching/)).toBeVisible();
  const active = page.getByRole("list", { name: "Active filters" });
  await expect(active).toContainText("Up to 2 km");
  await expect(page.getByRole("list", { name: "Routes" }).getByRole("link")).toHaveText([name]);
  await active.getByRole("link", { name: "Remove filter: Loop" }).click();
  await expect(page).not.toHaveURL(/loop=1/);
  await expect(page.getByRole("list", { name: "Routes" }).getByRole("link", { name })).toBeVisible();
  await page.goto(`/routes?text=${encodeURIComponent(stamp)}&min=5`);
  await expect(page.getByText("No routes match")).toBeVisible();
  await page.goto(`/routes?text=${encodeURIComponent(stamp)}`);
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(new RegExp(`${routePath}$`));
  await page.getByLabel("Overall (1–5)").selectOption("5");
  await page.getByLabel("Shade").selectOption("2");
  await page.getByLabel("Comment (optional, shown without your name)").fill("Hot after 8 am, go early.");
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(page.getByText("Thanks for the review.")).toBeVisible();
  await page.getByLabel("What did you see?").selectOption("construction");
  await page.getByLabel("Details").fill("Pipe works on the north side");
  await page.getByRole("button", { name: "Report a condition" }).click();
  await expect(page.getByText(/Other runners will see this for the next two weeks/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Condition reports" })).toContainText("Pipe works on the north side");
  await expect(page.getByText(/Reported by a runner today/)).toBeVisible();
  await expect(page.getByText("5.0★ overall from 1 runner")).toBeVisible();
  await expect(page.getByRole("list", { name: "Review comments" })).toContainText("Hot after 8 am, go early.");
  await expect(page.getByText("Route details")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
