// @vitest-environment node
/**
 * Approving coach-led programme requests. The database decides who may
 * approve (see supabase/tests/database/enrollment_approval.test.sql); these
 * tests cover the server action's own checks and how results are reported.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type FakeSupabase } from "../dashboard/fake-supabase";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
let currentUser: { id: string; roles: string[] } | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => currentUser }));
let client: FakeSupabase = fakeSupabase();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { canReviewEnrollments, listEnrollmentRequests, reviewEnrollment } =
  await import("@/features/workouts/enrollment-requests");
const { reviewEnrollmentAction } = await import("@/features/workouts/actions");

const ID = "0b0e7f3e-5c2a-4c9e-9a51-2f6f1f1f1f1f";
const asClient = (fake: FakeSupabase) => fake as unknown as SupabaseClient;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const callsOf = (fake: FakeSupabase) => fake.queries.flatMap((q) => q.calls.map((c) => [c.method, ...c.args]));

beforeEach(() => {
  revalidatePath.mockClear();
  currentUser = null;
  client = fakeSupabase();
});

describe("canReviewEnrollments", () => {
  it("allows coaches, programme managers and admins", () => {
    expect(canReviewEnrollments(["runner", "coach"])).toBe(true);
    expect(canReviewEnrollments(["runner", "programme_manager"])).toBe(true);
    expect(canReviewEnrollments(["admin"])).toBe(true);
  });
  it("does not allow runners or mentors", () => {
    expect(canReviewEnrollments(["runner"])).toBe(false);
    expect(canReviewEnrollments(["runner", "mentor"])).toBe(false);
  });
});

describe("listEnrollmentRequests", () => {
  it("lists waiting requests, excluding the viewer's own, oldest first", async () => {
    const fake = fakeSupabase({
      enrollments: {
        data: [
          {
            id: "e1",
            created_at: "2026-11-01T04:00:00Z",
            runner: { display_name: "Asha" },
            programme: { title: "Training and Shine", slug: "training-and-shine" },
          },
          { id: "e2", created_at: "2026-11-02T04:00:00Z", runner: null, programme: null },
        ],
        error: null,
      },
    });
    const requests = await listEnrollmentRequests(asClient(fake), "viewer-1");
    expect(requests).toEqual([
      {
        id: "e1",
        runnerName: "Asha",
        programmeTitle: "Training and Shine",
        programmeSlug: "training-and-shine",
        requestedAt: "2026-11-01T04:00:00Z",
      },
      {
        id: "e2",
        runnerName: "A runner",
        programmeTitle: "A programme",
        programmeSlug: null,
        requestedAt: "2026-11-02T04:00:00Z",
      },
    ]);
    expect(callsOf(fake)).toEqual(
      expect.arrayContaining([
        ["eq", "status", "requested"],
        ["neq", "user_id", "viewer-1"],
        ["order", "created_at", { ascending: true }],
        ["limit", 100],
      ]),
    );
  });

  it("throws when the requests cannot be loaded", async () => {
    const fake = fakeSupabase({ enrollments: { data: null, error: { code: "XX000", message: "boom" } } });
    await expect(listEnrollmentRequests(asClient(fake), "viewer-1")).rejects.toThrow(/boom/);
  });
});

describe("reviewEnrollment", () => {
  it("approves by activating a request that is still waiting", async () => {
    const fake = fakeSupabase({ enrollments: { data: [{ id: ID }], error: null } });
    expect(await reviewEnrollment(asClient(fake), ID, "approve")).toEqual({ ok: true });
    expect(callsOf(fake)).toEqual([
      ["update", { status: "active" }],
      ["eq", "id", ID],
      ["eq", "status", "requested"],
      ["select", "id"],
    ]);
  });

  it("declines by withdrawing the request", async () => {
    const fake = fakeSupabase({ enrollments: { data: [{ id: ID }], error: null } });
    expect(await reviewEnrollment(asClient(fake), ID, "decline")).toEqual({ ok: true });
    expect(callsOf(fake)[0]).toEqual(["update", { status: "withdrawn" }]);
  });

  it("reports a request that was already decided or is not visible", async () => {
    const fake = fakeSupabase({ enrollments: { data: [], error: null } });
    expect(await reviewEnrollment(asClient(fake), ID, "approve")).toEqual({
      ok: false,
      message: "This request has already been handled.",
    });
  });

  it("reports a refusal from the database", async () => {
    const fake = fakeSupabase({
      enrollments: { data: null, error: { code: "42501", message: "enrolment requires coach approval" } },
    });
    expect(await reviewEnrollment(asClient(fake), ID, "approve")).toEqual({
      ok: false,
      message: "You cannot review this request.",
    });
  });
});

describe("reviewEnrollmentAction", () => {
  it("sends signed-out visitors to sign in", async () => {
    await expect(
      reviewEnrollmentAction({ status: "idle" }, form({ enrollmentId: ID, decision: "approve" })),
    ).rejects.toThrow("redirect:/sign-in");
  });

  it("refuses runners and mentors without touching the database", async () => {
    for (const roles of [["runner"], ["runner", "mentor"]]) {
      currentUser = { id: "u1", roles };
      const result = await reviewEnrollmentAction({ status: "idle" }, form({ enrollmentId: ID, decision: "approve" }));
      expect(result).toEqual({ status: "error", message: "Only coaches and programme managers can review requests." });
    }
    expect(client.queries).toHaveLength(0);
  });

  it("rejects malformed input", async () => {
    currentUser = { id: "c1", roles: ["runner", "coach"] };
    for (const fields of [
      { enrollmentId: "not-a-uuid", decision: "approve" },
      { enrollmentId: ID, decision: "complete" },
    ]) {
      expect(await reviewEnrollmentAction({ status: "idle" }, form(fields))).toEqual({
        status: "error",
        message: "Request not found.",
      });
    }
    expect(client.queries).toHaveLength(0);
  });

  it("approves through the coach's own session and refreshes the coach page", async () => {
    currentUser = { id: "c1", roles: ["runner", "coach"] };
    client = fakeSupabase({ enrollments: { data: [{ id: ID }], error: null } });
    expect(await reviewEnrollmentAction({ status: "idle" }, form({ enrollmentId: ID, decision: "approve" }))).toEqual({
      status: "idle",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/coach");
  });

  it("passes on the database's answer when the coach may not decide", async () => {
    currentUser = { id: "c1", roles: ["runner", "coach"] };
    client = fakeSupabase({ enrollments: { data: [], error: null } });
    expect(await reviewEnrollmentAction({ status: "idle" }, form({ enrollmentId: ID, decision: "approve" }))).toEqual({
      status: "error",
      message: "This request has already been handled.",
    });
    expect(revalidatePath).not.toHaveBeenCalledWith("/coach");
  });
});
