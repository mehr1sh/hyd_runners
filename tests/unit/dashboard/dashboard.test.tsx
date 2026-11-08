import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "@/features/gamification/logic/time";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { fakeSupabase, missingTable, type FakeSupabase, type Query, type QueryResult } from "./fake-supabase";

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
// Server actions are only passed through as props; they are never invoked here.
vi.mock("@/features/workouts/actions", () => ({ startWorkoutAction: vi.fn() }));

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

let ctx: Awaited<ReturnType<typeof import("@/features/dashboard/context").getRunnerContext>>;
vi.mock("@/features/dashboard/context", () => ({ getRunnerContext: async () => ctx }));

const { loadDashboardState } = await import("@/features/dashboard/queries");
const { default: DashboardRoute } = await import("@/app/(app)/dashboard/page");
const DashboardPage = (searchParams: Record<string, string> = {}) =>
  DashboardRoute({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });

const TZ = "Asia/Kolkata";
const COUCH_ID = "0547c1bc-2e00-51d2-8107-df7f55515630";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function makeCtx(supabase: FakeSupabase, displayName = "Asha Rao"): NonNullable<typeof ctx> {
  return {
    user: { id: "user-1", email: "asha@example.test", displayName, roles: ["runner"], onboarded: true },
    supabase: supabase as never,
    timezone: TZ,
    today: localDate(new Date(), TZ),
    isDemo: false,
  };
}

/** A runner with an active Couch to 5K enrolment, one past workout and a badge. */
function completeRunnerTables() {
  const completedWorkout = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    title: "Easy run",
    workout_type: "run",
    started_at: daysAgo(2),
    completed_at: daysAgo(2),
    duration_seconds: 1800,
    distance_meters: 4000,
    perceived_effort: 5,
    notes: null,
    source: "manual",
    programme_session_id: null,
    enrollment_id: null,
    planned_workout_id: null,
    location_id: null,
  };
  return {
    // completedSessions() filters with .in(enrollment_id); listCompletedWorkouts() does not.
    workout_logs: (q: Query): QueryResult =>
      q.calls.some((c) => c.method === "in")
        ? { data: [], error: null }
        : q.calls.some((c) => c.method === "eq" && c.args[1] === "in_progress")
          ? { data: [], error: null }
          : { data: [completedWorkout], error: null },
    programmes: {
      data: [
        {
          id: COUCH_ID,
          slug: "couch-to-5k",
          title: "Couch to 5K",
          summary: "Nine weeks from walking to running 5 km.",
          kind: "couch_to_5k",
          category: "couch_to_5k",
          level: "beginner",
          duration_weeks: 9,
          sessions_per_week: 3,
          enrolment: "open",
          published: true,
          owner_id: null,
          sort_order: 10,
          programme_sessions: [
            {
              id: "s-1",
              week: 1,
              day: 1,
              title: "Week 1, run 1: intervals",
              workout_type: "walk_run",
              estimated_minutes: 30,
            },
            {
              id: "s-2",
              week: 1,
              day: 2,
              title: "Week 1, run 2: intervals",
              workout_type: "walk_run",
              estimated_minutes: 30,
            },
          ],
        },
      ],
      error: null,
    },
    enrollments: {
      data: [{ id: "e-1", programme_id: COUCH_ID, status: "active", started_at: daysAgo(3), completed_at: null }],
      error: null,
    },
    xp_ledger: {
      data: [
        { delta_xp: 50, delta_coins: 5, reason: "workout_completed", award_key: "workout:1", occurred_at: daysAgo(2) },
      ],
      error: null,
    },
    user_badges: { data: [{ badge_code: "first-workout", earned_at: daysAgo(2) }], error: null },
  };
}

/** Every relation the dashboard reads, missing (production before migrations). */
const NO_SCHEMA = Object.fromEntries(
  ["workout_logs", "programmes", "enrollments", "events", "xp_ledger", "user_badges", "scheduled_workouts"].map((t) => [
    t,
    missingTable(t),
  ]),
);

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe("loadDashboardState", () => {
  it("builds an empty-state dashboard when the runner has no programmes or workouts", async () => {
    client = fakeSupabase();
    const state = await loadDashboardState(makeCtx(client));
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.data.today).toEqual({ kind: "none" });
    expect(state.data.upcoming).toEqual([]);
    expect(state.data.programmes).toEqual([]);
    expect(state.data.totalWorkouts).toBe(0);
    expect(state.data.game.summary.totalXp).toBe(0);
  });

  it("returns schema_missing (and logs the relation) when the app tables do not exist", async () => {
    client = fakeSupabase(NO_SCHEMA);
    const state = await loadDashboardState(makeCtx(client));
    expect(state.status).toBe("schema_missing");
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/Database schema is not deployed \(\w+\)/));
  });

  it("returns schema_missing when a single required table is missing", async () => {
    client = fakeSupabase({ user_badges: missingTable("user_badges") });
    await expect(loadDashboardState(makeCtx(client))).resolves.toEqual({
      status: "schema_missing",
      source: "user_badges",
    });
  });

  it("rethrows other database failures for the error boundary", async () => {
    client = fakeSupabase({
      workout_logs: { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } },
    });
    const failure = loadDashboardState(makeCtx(client));
    await expect(failure).rejects.toBeInstanceOf(DatabaseQueryError);
    await expect(failure).rejects.toMatchObject({ code: "57014", source: "workout_logs" });
  });

  it("shows the not-available notice when a new database function is not deployed yet", async () => {
    client = fakeSupabase({
      "rpc:my_reward_totals": {
        data: null,
        error: { message: "Could not find the function public.my_reward_totals", code: "PGRST202" },
      },
    });
    await expect(loadDashboardState(makeCtx(client))).resolves.toMatchObject({ status: "schema_missing" });
  });

  it("uses database totals and a database count, not the rows the API returns", async () => {
    client = fakeSupabase({
      ...completeRunnerTables(),
      "rpc:my_reward_totals": { data: [{ total_xp: 12345, total_coins: 678, ledger_rows: 4000 }], error: null },
    });
    const state = await loadDashboardState(makeCtx(client));
    if (state.status !== "ready") throw new Error(state.status);
    expect(state.data.game.summary.totalXp).toBe(12345);
    expect(state.data.game.summary.coins).toBe(678);
  });

  it("treats a missing scheduler table as no planned workouts, not a failure", async () => {
    client = fakeSupabase({ scheduled_workouts: missingTable("scheduled_workouts") });
    expect((await loadDashboardState(makeCtx(client))).status).toBe("ready");
  });
});

describe("DashboardPage (server render)", () => {
  it("renders a complete runner's plan, progress and achievements", async () => {
    client = fakeSupabase(completeRunnerTables());
    ctx = makeCtx(client);
    render(await DashboardPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Asha Rao");
    expect(screen.getByText("Week 1, run 1: intervals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start session" })).toBeInTheDocument();
    expect(screen.getByText("Goal progress")).toBeInTheDocument();
    expect(screen.getByText("50 XP")).toBeInTheDocument();
    expect(screen.getByText(/1 of \d+ badges earned/)).toBeInTheDocument();
  });

  it("renders empty states for a runner without a profile, programmes or workouts", async () => {
    client = fakeSupabase();
    ctx = makeCtx(client, "Runner");
    render(await DashboardPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Runner");
    expect(screen.getByText("Nothing planned yet")).toBeInTheDocument();
    expect(screen.getByText("0 XP")).toBeInTheDocument();
    expect(screen.getByText("No events scheduled right now.")).toBeInTheDocument();
    expect(screen.queryByText("Goal progress")).not.toBeInTheDocument();
  });

  it("shows a setup notice instead of crashing when the database schema is missing", async () => {
    client = fakeSupabase(NO_SCHEMA);
    ctx = makeCtx(client, "Runner");
    render(await DashboardPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Runner");
    expect(screen.getByRole("status")).toHaveTextContent("Your dashboard is not available yet.");
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("confirms a completed password reset only for the known notice value", async () => {
    client = fakeSupabase(completeRunnerTables());
    ctx = makeCtx(client);
    const { unmount } = render(await DashboardPage({ notice: "password-updated" }));
    expect(screen.getByRole("status")).toHaveTextContent(/password updated/i);
    unmount();

    render(await DashboardPage({ notice: "<script>alert(1)</script>" }));
    expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/script/)).not.toBeInTheDocument();
  });

  it("propagates unexpected database failures to the error boundary", async () => {
    client = fakeSupabase({ xp_ledger: { data: null, error: { message: "JWT expired", code: "PGRST303" } } });
    ctx = makeCtx(client);
    await expect(DashboardPage()).rejects.toThrow("JWT expired");
  });
});

describe("DashboardPage (SSR + hydration)", () => {
  async function expectCleanHydration(tables: Parameters<typeof fakeSupabase>[0], displayName?: string) {
    client = fakeSupabase(tables);
    ctx = makeCtx(client, displayName);
    const tree = await DashboardPage();
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    const serverHtml = container.innerHTML;

    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringMatching(/hydrat/i), expect.anything());
    expect(container.innerHTML).toBe(serverHtml);
    container.remove();
  }

  it("hydrates a complete dashboard without mismatches", () => expectCleanHydration(completeRunnerTables()));
  it("hydrates the empty dashboard without mismatches", () => expectCleanHydration({}, "Runner"));
  it("hydrates the setup notice without mismatches", () => expectCleanHydration(NO_SCHEMA, "Runner"));
});
