// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  enforcedCsp,
  originOf,
  permissionsPolicy,
  reportOnlyCsp,
  securityHeaders,
  tileSource,
  type SecurityHeadersEnv,
} from "@/lib/security/headers";

const PROD: SecurityHeadersEnv = {
  nodeEnv: "production",
  vercelEnv: "production",
  supabaseUrl: "https://abcd.supabase.co",
  mapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

function header(env: SecurityHeadersEnv, key: string) {
  return securityHeaders(env).find((h) => h.key === key)?.value;
}

function directives(policy: string) {
  return new Map(
    policy.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources] as const;
    }),
  );
}

describe("security headers", () => {
  it("send HSTS without preload, nosniff, referrer policy and frame denial", () => {
    expect(header(PROD, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(header(PROD, "Strict-Transport-Security")).not.toMatch(/preload/);
    expect(header(PROD, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(PROD, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(PROD, "X-Frame-Options")).toBe("DENY");
  });

  it("deny powerful features, including geolocation (the app never asks for it)", () => {
    const policy = permissionsPolicy();
    for (const feature of ["camera", "microphone", "payment", "usb", "geolocation"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(header(PROD, "Permissions-Policy")).toBe(policy);
  });

  it("enforce only the baseline CSP that cannot break pages", () => {
    const enforced = directives(enforcedCsp());
    expect(enforced.get("frame-ancestors")).toEqual(["'none'"]);
    expect(enforced.get("object-src")).toEqual(["'none'"]);
    expect(enforced.get("base-uri")).toEqual(["'self'"]);
    expect(enforced.get("form-action")).toEqual(["'self'"]);
    expect(enforced.has("script-src")).toBe(false);
    expect(enforced.has("default-src")).toBe(false);
    expect(header(PROD, "Content-Security-Policy")).toBe(enforcedCsp());
  });

  it("report violations to the CSP report endpoint", () => {
    expect(header(PROD, "Reporting-Endpoints")).toBe('csp-endpoint="/api/v1/csp-report"');
    for (const policy of [enforcedCsp(), reportOnlyCsp(PROD)]) {
      expect(directives(policy).get("report-uri")).toEqual(["/api/v1/csp-report"]);
      expect(directives(policy).get("report-to")).toEqual(["csp-endpoint"]);
    }
  });

  it("list the Supabase and tile origins in the report-only policy", () => {
    const policy = directives(header(PROD, "Content-Security-Policy-Report-Only")!);
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", "https://abcd.supabase.co"]);
    expect(policy.get("img-src")).toContain("https://tile.openstreetmap.org");
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["'none'"]);
  });

  it("never allow 'unsafe-eval' in production, only in development", () => {
    const prod = header(PROD, "Content-Security-Policy-Report-Only")!;
    expect(prod).not.toContain("unsafe-eval");
    expect(header({ ...PROD, vercelEnv: "preview" }, "Content-Security-Policy-Report-Only")).not.toContain(
      "unsafe-eval",
    );
    const dev = directives(reportOnlyCsp({ ...PROD, nodeEnv: "development", vercelEnv: undefined }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
  });

  it("allow the Vercel toolbar on Preview deployments only", () => {
    expect(reportOnlyCsp(PROD)).not.toContain("vercel.live");
    const preview = directives(reportOnlyCsp({ ...PROD, vercelEnv: "preview" }));
    expect(preview.get("script-src")).toContain("https://vercel.live");
    expect(preview.get("frame-src")).toEqual(["https://vercel.live"]);
  });

  it("fall back to OpenStreetMap tiles and omit a missing Supabase URL", () => {
    const policy = directives(reportOnlyCsp({ nodeEnv: "production" }));
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toContain("https://tile.openstreetmap.org");
  });

  it("derive sources safely from configured URLs", () => {
    expect(originOf("http://127.0.0.1:54321/rest/v1")).toBe("http://127.0.0.1:54321");
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(tileSource("https://{s}.tile.example.org/{z}/{x}/{y}.png")).toBe("https://*.tile.example.org");
    expect(tileSource("https://tiles.example.com:8443/{z}/{x}/{y}.png")).toBe("https://tiles.example.com:8443");
    expect(tileSource("https://evil.example; script-src *")).toBeNull();
    expect(tileSource("data:image/png;base64,AAAA")).toBeNull();
  });
});
