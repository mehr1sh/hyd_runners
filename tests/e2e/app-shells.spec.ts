import { expect, test } from "@playwright/test";

/**
 * App shells render in preview mode (no Supabase). When Supabase is configured,
 * protected routes must redirect signed-out visitors to /sign-in instead.
 */
const ROUTES = [
  "/dashboard",
  "/onboarding",
  "/schedule",
  "/programmes",
  "/workouts",
  "/reports",
  "/community",
  "/events",
  "/map",
  "/profile",
  "/coach",
  "/manager",
];

for (const route of ROUTES) {
  test(`${route} renders a shell or redirects to sign-in`, async ({ page }) => {
    await page.goto(route);
    if (new URL(page.url()).pathname === "/sign-in") {
      await expect(page.getByLabel("Email")).toBeVisible();
      return;
    }
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeAttached();

    // No horizontal page scroll at any viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
