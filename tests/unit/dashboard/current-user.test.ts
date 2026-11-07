import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, missingTable, type FakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: true,
}));

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { getCurrentUser } = await import("@/lib/auth/current-user");

describe("getCurrentUser", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("returns the profile name, roles and onboarding state for a complete profile", async () => {
    client = fakeSupabase({
      profiles: { data: [{ display_name: "Asha Rao", onboarded_at: "2026-10-01T00:00:00Z" }], error: null },
      user_roles: { data: [{ role: "runner" }, { role: "coach" }], error: null },
    });
    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "asha@example.test",
      displayName: "Asha Rao",
      roles: ["runner", "coach"],
      onboarded: true,
    });
  });

  it("falls back to a not-onboarded 'Runner' when the user has no profile row", async () => {
    client = fakeSupabase({ profiles: { data: [], error: null }, user_roles: { data: [], error: null } });
    const user = await getCurrentUser();
    expect(user).toMatchObject({ id: "user-1", displayName: "Runner", onboarded: false });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns no roles (not staff) when the user has no role rows", async () => {
    client = fakeSupabase({
      profiles: { data: [{ display_name: "Asha Rao", onboarded_at: null }], error: null },
      user_roles: { data: [], error: null },
    });
    expect((await getCurrentUser())?.roles).toEqual([]);
  });

  it("keeps the session but logs when the profile and role tables are missing", async () => {
    client = fakeSupabase({ profiles: missingTable("profiles"), user_roles: missingTable("user_roles") });
    const user = await getCurrentUser();
    expect(user).toMatchObject({ id: "user-1", displayName: "Runner", roles: [] });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Could not load profile (PGRST205)"));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Could not load roles (PGRST205)"));
  });

  it("returns null when there is no verified session", async () => {
    client = fakeSupabase({}, null);
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
