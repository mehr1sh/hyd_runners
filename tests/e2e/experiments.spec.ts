import { expect, test, type Page } from "@playwright/test";
import { adminClient, PASSWORD, usesLocalDatabase, WRITES_DATA } from "./support/database";

/** Experiments: ghost runner, route collection, run roulette, mystery runs, club pass and captains. */
test.skip(!usesLocalDatabase(), WRITES_DATA);

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

const LINE = "SRID=4326;LINESTRING(78.40 17.40,78.41 17.40,78.42 17.40)";

test("ghost runner, collection, roulette and a mystery reveal use real data", async ({ page }, testInfo) => {
  const admin = adminClient();
  test.skip(!admin, "Secret key not available");
  if (!admin) return;
  const stamp = `${testInfo.project.name}${Date.now()}`;
  const email = `e2e-ex-${stamp}@example.test`;
  const { data: u, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Exp ${stamp}` },
  });
  if (error) throw new Error(error.message);
  const uid = u.user.id;
  await admin.from("user_roles").insert({ user_id: uid, role: "programme_manager" });
  // A verified route, created the way organisers do it (GPX upload, then verification).
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${[
    78.4, 78.405, 78.41, 78.415, 78.42,
  ]
    .map(
      (lon, i) => `<trkpt lat="17.40" lon="${lon}"><ele>${540 + i}</ele><time>2026-01-01T06:0${i}:00Z</time></trkpt>`,
    )
    .join("")}</trkseg></trk></gpx>`;
  await signInAs(page, email);
  await page.goto("/routes/new");
  await page.getByLabel("Route name").fill(`Exp loop ${stamp}`);
  await page.getByLabel("Area (optional)").fill(`Zq${stamp}`);
  await page
    .getByLabel("GPX file (up to 2.5 MB)")
    .setInputFiles({ name: "line.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await page.getByLabel("Publish straight away").check();
  await page.getByRole("button", { name: "Upload route" }).click();
  await expect(page).toHaveURL(/\/routes\/exp-loop-/);
  await page.getByLabel("Verified on the ground").check();
  await page.getByRole("button", { name: "Save route details" }).click();
  await expect(page.getByText("Route saved.")).toBeVisible();
  const slug = new URL(page.url()).pathname.split("/").pop()!;
  const { data: route, error: rErr } = await admin.from("routes").select("id, distance_m").eq("slug", slug).single();
  if (rErr) throw new Error(rErr.message);
  // Two runs on the route: last week slower, yesterday faster.
  const runs: string[] = [];
  for (const [daysAgo, paces] of [
    [8, [330, 330]],
    [1, [320, 325]],
  ] as const) {
    const start = new Date(Date.now() - daysAgo * 86_400_000);
    const { data: a, error: aErr } = await admin
      .from("activities")
      .insert({
        user_id: uid,
        activity_type: "run",
        status: "ready",
        source_format: "gpx",
        started_at: start.toISOString(),
        ended_at: new Date(start.getTime() + 720_000).toISOString(),
        elapsed_seconds: 720,
        moving_seconds: 710,
        moving_source: "derived",
        distance_m: Number(route.distance_m),
        avg_pace_s: 330,
        has_gps: true,
        public_path: LINE,
        km_splits: paces.map((p, i) => ({ index: i + 1, meters: 1000, seconds: p, pace: p, partial: false })),
      })
      .select("id")
      .single();
    if (aErr) throw new Error(aErr.message);
    const { error: tErr } = await admin.from("activity_tracks").insert({
      activity_id: a.id,
      user_id: uid,
      path: LINE,
      samples: [],
      file_path: `${uid}/${a.id}`,
      file_sha256: (daysAgo === 8 ? "a" : "b").repeat(64),
      file_bytes: 10,
    });
    if (tErr) throw new Error(tErr.message);
    runs.push(a.id);
  }

  await page.goto(`/activities/${runs[1]}`);
  const ghost = page.getByRole("region", { name: "Ghost runner" });
  await expect(ghost).toContainText("0:15 ahead after 2 km");
  await expect(ghost.getByRole("list", { name: "Ghost comparison by kilometre" })).toContainText("km 1");

  await page.goto("/routes/collection");
  await expect(page.getByRole("region", { name: `Zq${stamp} collection` })).toContainText("2× · first");

  await page.goto(`/routes/roulette?spin=1&area=Zq${stamp}`);
  await expect(page.getByRole("heading", { name: `Exp loop ${stamp}` })).toBeVisible();
  await expect(page.getByText(/picked from 1 verified route/)).toBeVisible();

  // Mystery run: hidden before the reveal, shown after.
  const { data: ev } = await admin
    .from("events")
    .insert({
      title: `Mystery ${stamp}`,
      starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(),
      status: "published",
      mystery_route_id: route.id,
      mystery_reveal_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  // Viewed by a runner (organisers and managers can always see the route).
  const runnerEmail = `e2e-ex-r-${stamp}@example.test`;
  await admin.auth.admin.createUser({
    email: runnerEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Exp runner ${stamp}` },
  });
  await signInAs(page, runnerEmail);
  await page.goto(`/events/${ev!.id}`);
  const mystery = page.getByRole("region", { name: "Mystery run" });
  await expect(mystery).toContainText("The route is revealed");
  await expect(mystery.getByRole("link")).toHaveCount(0);
  await admin
    .from("events")
    .update({ mystery_reveal_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", ev!.id);
  await page.reload();
  await expect(mystery.getByRole("link", { name: `Exp loop ${stamp}` })).toBeVisible();

  await page.goto("/clubs/pass");
  await expect(page.getByText("No clubs yet")).toBeVisible();
  await page.goto("/captains");
  await expect(page.getByRole("heading", { name: "Run captains" })).toBeVisible();
});
