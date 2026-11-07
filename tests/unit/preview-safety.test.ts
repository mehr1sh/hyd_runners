// @vitest-environment node
/**
 * Vercel Production and Preview share one Supabase project. These guards keep
 * Preview deployments and test runs from creating real accounts, running
 * privileged writes, or shipping a secret key to the browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLoopbackUrl, usesLocalDatabase } from "../e2e/support/database";
import { isLocalSupabaseUrl } from "./local-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("must not reach Supabase");
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "user-1", displayName: "Asha", roles: ["runner"], onboarded: true }),
}));

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
};

async function withEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...SUPABASE, ...env })) vi.stubEnv(k, v as string);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function jwt(payload: object) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

describe("public Supabase key", () => {
  it("rejects secret and legacy service_role keys, accepts publishable and anon keys", async () => {
    const { isSecretSupabaseKey } = await import("@/lib/env");
    expect(isSecretSupabaseKey("sb_secret_abc")).toBe(true);
    expect(isSecretSupabaseKey(jwt({ role: "service_role" }))).toBe(true);
    expect(isSecretSupabaseKey("sb_publishable_abc")).toBe(false);
    expect(isSecretSupabaseKey(jwt({ role: "anon" }))).toBe(false);
  });

  it("refuses to load configuration with a secret key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", async () => {
    await withEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_leaked" });
    await expect(import("@/lib/env")).rejects.toThrow(/holds a secret key/);
  });
});

describe("Preview deployments", () => {
  const signUpForm = () => {
    const f = new FormData();
    f.set("email", "new@example.test");
    f.set("password", "correct-horse-battery");
    f.set("displayName", "New Runner");
    return f;
  };

  it("turn sign-up off before any account is created", async () => {
    await withEnv({ VERCEL_ENV: "preview" });
    const { signUp } = await import("@/features/identity/actions");
    await expect(signUp({ status: "idle" }, signUpForm())).resolves.toEqual({
      status: "error",
      message: "Sign-up is turned off on preview deployments. Sign in with a test account.",
    });
  });

  it("keep sign-up on in production", async () => {
    await withEnv({ VERCEL_ENV: "production" });
    const { signUp } = await import("@/features/identity/actions");
    // Reaches Supabase (mocked to throw), i.e. it was not blocked.
    await expect(signUp({ status: "idle" }, signUpForm())).rejects.toThrow("must not reach Supabase");
  });

  it("never run the demo seed, even with a token", async () => {
    await withEnv({ VERCEL_ENV: "preview", DEMO_SEED_TOKEN: "t" });
    const { POST } = await import("@/app/api/v1/dev/seed-demo/route");
    const res = await POST(
      new Request("http://x/api/v1/dev/seed-demo", { method: "POST", headers: { authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(404);
  });

  it("explain that workouts cannot be saved without the secret key", async () => {
    await withEnv({ VERCEL_ENV: "preview", SUPABASE_SECRET_KEY: "" });
    const { startWorkoutAction } = await import("@/features/workouts/actions");
    const form = new FormData();
    form.set("kind", "free");
    form.set("workoutType", "run");
    form.set("title", "Easy run");
    await expect(startWorkoutAction({ status: "idle" }, form)).resolves.toEqual({
      status: "error",
      message: "Saving workouts is not available on this deployment.",
    });
  });
});

describe("test database guards", () => {
  it("treat only loopback Supabase URLs as disposable", () => {
    for (const check of [isLoopbackUrl, isLocalSupabaseUrl]) {
      expect(check("http://127.0.0.1:54321")).toBe(true);
      expect(check("http://localhost:54321")).toBe(true);
      expect(check("https://nhazbqwzdxcvurdfwaos.supabase.co")).toBe(false);
      expect(check(undefined)).toBe(false);
      expect(check("not a url")).toBe(false);
    }
  });

  it("never treat a deployed base URL as a local database", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(usesLocalDatabase()).toBe(true);
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "https://hydrunners-preview.vercel.app");
    expect(usesLocalDatabase()).toBe(false);
  });
});
