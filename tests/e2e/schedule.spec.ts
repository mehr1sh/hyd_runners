import { expect, test, type Page } from "@playwright/test";
import { usesLocalDatabase, WRITES_DATA } from "./support/database";

// Writes accounts and data: never against the shared Production/Preview database.
test.skip(!usesLocalDatabase(), WRITES_DATA);

/**
 * Schedule planner end to end. Runs only when Supabase is configured; AI is
 * expected to be off (AI_PROVIDER=none), so this is the deterministic path.
 */

function buildPdf(lines: string[]): Buffer {
  const content = `BT /F1 11 Tf 14 TL 50 760 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

async function signUp(page: Page, tag: string) {
  await page.goto("/sign-up");
  await page.getByLabel(/what should we call you/i).fill("Planner E2E");
  await page.getByLabel("Email").fill(`plan-${tag}-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

async function fillRow(page: Page, row: number, day: string, start: string, end: string, kind?: "Busy") {
  const rows = page.getByRole("list", { name: "Weekly times" }).locator(":scope > li");
  const r = rows.nth(row);
  await r.getByLabel("Day").selectOption({ label: day });
  if (kind) await r.getByLabel("Type").selectOption({ label: kind });
  await r.getByLabel("Start").fill(start);
  await r.getByLabel("End").fill(end);
}

test("plan a week: upload, review, manual times, generate, edit, approve, reschedule", async ({
  page,
  request,
}, testInfo) => {
  const health = await (await request.get("/api/v1/health")).json();
  test.skip(!health.data.supabaseConfigured, "Supabase not configured");
  test.setTimeout(120_000);

  await signUp(page, testInfo.project.name);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  // File inputs set before hydration would lose their change event.
  await page.waitForLoadState("networkidle");

  // Upload a text PDF: rows come back unconfirmed and cannot be saved until checked.
  await page.locator("#timetable-file").setInputFiles({
    name: "timetable.pdf",
    mimeType: "application/pdf",
    buffer: buildPdf(["Monday 09:00-17:00 Classes", "Wednesday 09:00-17:00 Classes"]),
  });
  await page.getByRole("button", { name: "Upload and read" }).click();
  await expect(page.getByText(/Read 2 rows/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Save availability" })).toBeDisabled();
  for (const box of await page.getByLabel("This row is correct").all()) await box.check();

  // Unsupported files are refused before upload.
  await page.getByRole("button", { name: "Upload another" }).click();
  await page
    .locator("#timetable-file")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByText(/Upload a PDF, PNG, JPG or WebP file/)).toBeVisible();

  // Manual free time, including an invalid row that blocks saving until fixed.
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const [i, day] of days.entries()) {
    await page.getByRole("button", { name: "Free time" }).click();
    await fillRow(page, 2 + i, day, i === 1 ? "08:00" : "06:00", i === 1 ? "07:00" : "07:30");
  }
  await expect(page.getByText(/the end must be after the start/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save availability" })).toBeDisabled();
  await fillRow(page, 3, "Tuesday", "06:00", "07:30");
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();

  // Generate without AI.
  await page.getByLabel("Goal").selectOption({ label: "Run my first 5K" });
  await page.getByLabel("Experience").selectOption({ label: "New to running" });
  await page.getByLabel("Plan for").selectOption({ index: 1 });
  await expect(page.getByText(/AI suggestions are not set up/)).toBeVisible();
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect(page.getByRole("heading", { name: "Proposed week" })).toBeVisible();
  await expect(page.getByText("Standard planner", { exact: true })).toBeVisible();
  const editButtons = page.getByRole("button", { name: /^Edit / });
  await expect(editButtons).toHaveCount(3);

  // An edit into class time is rejected and the week is unchanged.
  await editButtons.first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Start").fill("10:00");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog.getByText("This change was not applied:")).toBeVisible();
  await expect(dialog.getByText(/is not inside your confirmed free time|overlaps your busy time/)).toBeVisible();

  // A valid edit is applied.
  await dialog.getByLabel("Start").fill("06:30");
  await dialog.getByLabel("Minutes").fill("25");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();

  // Approve and see the persisted week.
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByText("Plan approved and saved.")).toBeVisible();
  await expect(page.getByText(/Approved \d/)).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Approved week/ }).click();
  await page.getByLabel("Show approved plan for").selectOption({ index: 1 });
  await expect(page.getByText("Planned", { exact: true })).toHaveCount(3);

  // Reschedule a missed session.
  await page.getByRole("button", { name: "Missed it? Reschedule" }).first().click();
  await expect(page.getByText(/Session moved|left unchanged/)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
