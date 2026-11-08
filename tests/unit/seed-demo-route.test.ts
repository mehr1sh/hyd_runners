// @vitest-environment node
/**
 * POST /api/v1/dev/seed-demo fails closed: 404 unless explicitly enabled with
 * a long token, 404 on Vercel Production/Preview regardless, 401 for a bad or
 * malformed Authorization header, and no internal error text in responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerToken, safeEqual } from "@/lib/security/compare";

vi.mock("server-only", () => ({}));
const { seedDemoData } = vi.hoisted(() => ({ seedDemoData: vi.fn() }));
vi.mock("@/features/dashboard/demo-seed", () => ({ seedDemoData }));

const TOKEN = "a".repeat(20) + "-local-seed-token-0123";
const ENABLED = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  VERCEL_ENV: "",
  DEMO_SEED_ENABLED: "true",
  DEMO_SEED_TOKEN: TOKEN,
};

async function call(env: Record<string, string>, authorization?: string) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { POST } = await import("@/app/api/v1/dev/seed-demo/route");
  const headers: Record<string, string> = authorization === undefined ? {} : { authorization };
  return POST(new Request("http://x/api/v1/dev/seed-demo", { method: "POST", headers }));
}

beforeEach(() => {
  seedDemoData.mockReset();
  seedDemoData.mockResolvedValue({ demoEmail: "demo.runner@hydrunners.test", demoPassword: "generated" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("seed-demo access", () => {
  it("seeds with the right token when explicitly enabled", async () => {
    const res = await call(ENABLED, `Bearer ${TOKEN}`);
    expect(res.status).toBe(201);
    expect((await res.json()).data.demoPassword).toBe("generated");
    expect(seedDemoData).toHaveBeenCalledTimes(1);
  });

  it("is disabled by default, even in development with a token", async () => {
    const res = await call({ ...ENABLED, NODE_ENV: "development", DEMO_SEED_ENABLED: "" }, `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("is disabled when enabled without a token", async () => {
    const res = await call({ ...ENABLED, DEMO_SEED_TOKEN: "" }, "Bearer ");
    expect(res.status).toBe(404);
  });

  it("is disabled when the configured token is too short", async () => {
    const short = "x".repeat(31);
    const res = await call({ ...ENABLED, DEMO_SEED_TOKEN: short }, `Bearer ${short}`);
    expect(res.status).toBe(404);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it.each(["production", "preview"])("answers 404 on Vercel %s even with the right token", async (vercelEnv) => {
    const res = await call({ ...ENABLED, VERCEL_ENV: vercelEnv }, `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    const res = await call(ENABLED);
    expect(res.status).toBe(401);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("rejects a wrong token", async () => {
    for (const wrong of [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, "Bearer nope"]) {
      const res = await call(ENABLED, wrong);
      expect(res.status).toBe(401);
    }
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it.each([
    TOKEN,
    `Basic ${TOKEN}`,
    "Bearer",
    "Bearer  ",
    `Bearer  ${TOKEN}`,
    `Bearer ${TOKEN} extra`,
    `Token ${TOKEN}`,
  ])("rejects the malformed header %j", async (authorization) => {
    const res = await call(ENABLED, authorization);
    expect(res.status).toBe(401);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("logs the real error but returns a generic message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    seedDemoData.mockRejectedValue(new Error("duplicate key value violates unique constraint users_email_key"));
    const res = await call(ENABLED, `Bearer ${TOKEN}`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toMatch(/duplicate|constraint|users_email/);
    expect(logged).toHaveBeenCalled();
  });
});

describe("secret helpers", () => {
  it("compare secrets of any length without throwing", () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true);
    expect(safeEqual(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(safeEqual("", TOKEN)).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("parse only well-formed Bearer headers", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken(`Bearer a b`)).toBeNull();
  });
});
