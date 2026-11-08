import { expect, test, type Page } from "@playwright/test";
import { testAccount, usesLocalDatabase } from "./support/database";

/**
 * Security headers are sent, and no page violates the report-only Content
 * Security Policy. Violations are caught in the browser (the
 * `securitypolicyviolation` event and "[Report Only]" console messages), not
 * from the report endpoint, so the check does not depend on report delivery.
 * Read-only: signs in as the dedicated test account like test-account.spec.ts.
 */

const PUBLIC_PAGES = ["/", "/sign-in", "/sign-up"];
const APP_PAGES = [
  "/dashboard",
  "/map",
  "/events",
  "/community",
  "/programmes",
  "/schedule",
  "/workouts",
  "/reports",
  "/profile",
];

type Violation = { page: string; directive: string; blocked: string; disposition: string; source: string };

async function watchPolicy(page: Page) {
  const violations: Violation[] = [];
  const consoleProblems: string[] = [];
  await page.exposeFunction("__reportCspViolation", (v: Violation) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __reportCspViolation: (v: unknown) => void }).__reportCspViolation({
        page: location.pathname,
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
        source: `${e.sourceFile}:${e.lineNumber}`,
      });
    });
  });
  page.on("console", (m) => {
    if (/Content Security Policy|\[Report Only\]|Permissions-Policy|Permissions Policy/i.test(m.text())) {
      consoleProblems.push(m.text());
    }
  });
  return { violations, consoleProblems };
}

async function visit(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first(), route).toBeVisible();
}

test.describe("security headers", () => {
  for (const route of ["/", "/sign-in"]) {
    test(`${route} sends the security headers`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0 });
      const h = res.headers();
      expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["permissions-policy"]).toContain("geolocation=()");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"]).toContain("object-src 'none'");
      expect(h["content-security-policy"]).toContain("form-action 'self'");
      const reportOnly = h["content-security-policy-report-only"];
      expect(reportOnly).toContain("default-src 'self'");
      expect(reportOnly).toContain("report-uri /api/v1/csp-report");
      expect(reportOnly).not.toContain("unsafe-eval");
    });
  }

  test("the CSP report endpoint accepts a report", async ({ request }) => {
    const res = await request.post("/api/v1/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({
        "csp-report": {
          "document-uri": "http://localhost/e2e",
          "blocked-uri": "inline",
          "effective-directive": "script-src-elem",
          disposition: "report",
        },
      }),
    });
    expect(res.status()).toBe(204);
  });
});

test.describe("report-only CSP", () => {
  test("public pages cause no violations", async ({ page }) => {
    const { violations, consoleProblems } = await watchPolicy(page);
    for (const route of PUBLIC_PAGES) await visit(page, route);
    expect(violations).toEqual([]);
    expect(consoleProblems).toEqual([]);
  });

  test("signed-in app pages cause no violations", async ({ page, request }) => {
    const health = await (await request.get("/api/v1/health")).json();
    test.skip(!health.data.supabaseConfigured, "Supabase not configured");
    const account = await testAccount();
    test.skip(
      !account,
      usesLocalDatabase() ? "SUPABASE_SECRET_KEY not available" : "Set E2E_RUNNER_EMAIL and E2E_RUNNER_PASSWORD",
    );
    if (!account) return;

    const { violations, consoleProblems } = await watchPolicy(page);
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    for (const route of APP_PAGES) await visit(page, route);

    // Client-side navigation and sign-out (a Server Action form post) too.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /^Account menu for / }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/\/dashboard/);

    expect(violations).toEqual([]);
    expect(consoleProblems).toEqual([]);
  });
});
