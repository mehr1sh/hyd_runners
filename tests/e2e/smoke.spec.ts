import { expect, test } from "@playwright/test";

test("landing page explains the product and links to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/running habit/i);
  await expect(page.getByRole("link", { name: /start your plan/i }).first()).toHaveAttribute("href", "/sign-up");
  await expect(page.getByAltText(/hyderabad runners/i).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("auth pages render their forms", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.goto("/sign-up");
  await expect(page.getByLabel(/what should we call you/i)).toBeVisible();
});

test("unknown routes show the not-found page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /wrong turn/i })).toBeVisible();
});

test("health endpoint uses the API envelope", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({ data: { status: "ok", apiVersion: "v1" } });
});

test("/api/v1/me rejects anonymous callers", async ({ request }) => {
  const res = await request.get("/api/v1/me");
  expect([401, 500]).toContain(res.status());
  const body = await res.json();
  expect(body.error.code).toMatch(/unauthenticated|internal_error/);
});
