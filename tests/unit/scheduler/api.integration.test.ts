// @vitest-environment node
/**
 * Integration tests through the real route handlers and a real local Supabase
 * (Auth, Postgres + RLS, Storage). Opt-in, because `pnpm test` runs before
 * Supabase starts in CI:
 *
 *   pnpm db:start && pnpm db:reset
 *   set -a; . ./.env.local; set +a
 *   SCHEDULER_INTEGRATION=1 pnpm exec vitest run tests/unit/scheduler/api.integration.test.ts
 *
 * No AI provider is called: the AI-configured cases stub `fetch` for the
 * Gemini endpoint only and let Supabase traffic through.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isLocalSupabaseUrl } from "../local-supabase";
import { buildPdf } from "./pdf-fixture";

vi.mock("server-only", () => ({}));

const enabled =
  process.env.SCHEDULER_INTEGRATION === "1" &&
  isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SECRET_KEY);

const URL_BASE = "http://localhost/api/v1";
const PASSWORD = "integration-password-123";

type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
type Routes = {
  timetables: { POST: Handler };
  process: { POST: Handler };
  availability: { GET: Handler; PUT: Handler };
  proposals: { POST: Handler };
  validate: { POST: Handler };
  plans: { GET: Handler; POST: Handler };
  reschedule: { POST: Handler };
};

async function loadRoutes(): Promise<Routes> {
  return {
    timetables: (await import("@/app/api/v1/timetables/route")) as unknown as Routes["timetables"],
    process: (await import("@/app/api/v1/timetables/[id]/process/route")) as unknown as Routes["process"],
    availability: (await import("@/app/api/v1/availability/route")) as unknown as Routes["availability"],
    proposals: (await import("@/app/api/v1/schedule/proposals/route")) as unknown as Routes["proposals"],
    validate: (await import("@/app/api/v1/schedule/validate/route")) as unknown as Routes["validate"],
    plans: (await import("@/app/api/v1/schedule/plans/route")) as unknown as Routes["plans"],
    reschedule:
      (await import("@/app/api/v1/schedule/workouts/[id]/reschedule/route")) as unknown as Routes["reschedule"],
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function newUser(tag: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `sched-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, token: session.session!.access_token, admin };
}

function req(token: string | null, path: string, method = "GET", body?: unknown) {
  return new Request(`${URL_BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

/** Next Monday in IST, so rescheduling has the whole week ahead of it. */
function nextMonday() {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const day = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7));
  return monday.toISOString().slice(0, 10);
}

const SETTINGS = {
  goal: "first_5k",
  fitnessLevel: "new_to_running",
  sessionsPerWeek: 3,
  maxSessionMinutes: 30,
  preferredDays: [],
  preferredTimesOfDay: ["early_morning"],
  programmeWeek: 1,
};

const manual = (weekday: number, startTime: string, endTime: string, kind: "free" | "busy") => ({
  key: `${weekday}-${startTime}-${kind}`,
  weekday,
  startTime,
  endTime,
  kind,
  label: null,
  source: "manual",
  confidence: null,
  uncertainties: [],
  rawText: null,
  confirmed: true,
});

const WEEK_AVAILABILITY = [
  ...[1, 2, 3, 4, 5].map((d) => manual(d, "06:00", "07:30", "free")),
  ...[1, 2, 3, 4, 5].map((d) => manual(d, "09:00", "17:00", "busy")),
  manual(6, "07:00", "10:00", "free"),
];

describe.skipIf(!enabled)("scheduler API (integration)", () => {
  let routes: Routes;
  let a: Awaited<ReturnType<typeof newUser>>;
  let b: Awaited<ReturnType<typeof newUser>>;
  const weekStart = nextMonday();

  beforeAll(async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    routes = await loadRoutes();
    [a, b] = await Promise.all([newUser("a"), newUser("b")]);
  });

  afterAll(async () => {
    await a?.admin.auth.admin.deleteUser(a.id);
    await b?.admin.auth.admin.deleteUser(b.id);
    vi.unstubAllEnvs();
  });

  it("rejects callers without a valid token", async () => {
    const r = await json(await routes.availability.GET(req("not-a-real-token", "/availability")));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("unauthenticated");
  });

  it("uploads a PDF to private storage, reads it, and returns unconfirmed rows", async () => {
    const pdf = buildPdf(["Monday 09:00-12:00 Physics", "Wednesday 14:00-16:00 Lab"]);
    const reg = await json(
      await routes.timetables.POST(
        req(a.token, "/timetables", "POST", { mimeType: "application/pdf", sizeBytes: pdf.byteLength }),
      ),
    );
    expect(reg.status).toBe(201);
    expect(reg.body.data.upload.storagePath.startsWith(`${a.id}/`)).toBe(true);

    const put = await fetch(reg.body.data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf", "x-upsert": "false" },
      body: pdf,
    });
    expect(put.ok).toBe(true);

    const processed = await json(
      await routes.process.POST(
        req(a.token, `/timetables/${reg.body.data.upload.id}/process`, "POST"),
        params(reg.body.data.upload.id),
      ),
    );
    expect(processed.status).toBe(200);
    expect(processed.body.data.method).toBe("text_parser");
    expect(
      processed.body.data.drafts.map((d: { weekday: number; startTime: string }) => [d.weekday, d.startTime]),
    ).toEqual([
      [1, "09:00"],
      [3, "14:00"],
    ]);
    expect(processed.body.data.drafts.every((d: { confirmed: boolean }) => !d.confirmed)).toBe(true);
    expect(processed.body.data.upload.status).toBe("needs_review");

    // Another runner cannot process or even see this upload.
    const stolen = await routes.process.POST(
      req(b.token, `/timetables/${reg.body.data.upload.id}/process`, "POST"),
      params(reg.body.data.upload.id),
    );
    expect(stolen.status).toBe(404);

    // Unconfirmed extracted rows cannot be saved.
    const unconfirmed = await json(
      await routes.availability.PUT(
        req(a.token, "/availability", "PUT", {
          drafts: processed.body.data.drafts,
          sourceUploadId: reg.body.data.upload.id,
        }),
      ),
    );
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.error.details.issues.some((i: { code: string }) => i.code === "unconfirmed")).toBe(true);

    // Confirmed rows are saved and the stored file is deleted.
    const confirmed = processed.body.data.drafts.map((d: object) => ({ ...d, confirmed: true }));
    const saved = await json(
      await routes.availability.PUT(
        req(a.token, "/availability", "PUT", { drafts: confirmed, sourceUploadId: reg.body.data.upload.id }),
      ),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data.availability).toHaveLength(2);
    const { data: files } = await a.admin.storage.from("timetables").list(a.id);
    expect(files ?? []).toHaveLength(0);
  });

  it("rejects disguised and unsupported uploads on the server", async () => {
    const reg = await json(
      await routes.timetables.POST(req(a.token, "/timetables", "POST", { mimeType: "application/zip", sizeBytes: 10 })),
    );
    expect(reg.status).toBe(415);
    const big = await json(
      await routes.timetables.POST(
        req(a.token, "/timetables", "POST", { mimeType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }),
      ),
    );
    expect(big.status).toBe(413);

    // Declared PDF, but the bytes are a PNG.
    const fake = await json(
      await routes.timetables.POST(req(a.token, "/timetables", "POST", { mimeType: "application/pdf", sizeBytes: 12 })),
    );
    await fetch(fake.body.data.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    });
    const processed = await json(
      await routes.process.POST(
        req(a.token, `/timetables/${fake.body.data.upload.id}/process`, "POST"),
        params(fake.body.data.upload.id),
      ),
    );
    expect(processed.status).toBe(415);
    expect(processed.body.error.details.reason).toBe("content_mismatch");
  });

  it("explains that photos need AI when no provider is configured (Case H)", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const reg = await json(
      await routes.timetables.POST(
        req(a.token, "/timetables", "POST", { mimeType: "image/png", sizeBytes: png.byteLength }),
      ),
    );
    await fetch(reg.body.data.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: png });
    const processed = await json(
      await routes.process.POST(
        req(a.token, `/timetables/${reg.body.data.upload.id}/process`, "POST"),
        params(reg.body.data.upload.id),
      ),
    );
    expect(processed.status).toBe(503);
    expect(processed.body.error.details.reason).toBe("image_needs_ai");
    expect(processed.body.error.message).toMatch(/by hand/);
  });

  it("validates manual availability, generates, edits, approves, retrieves and reschedules a plan without AI", async () => {
    const bad = await json(
      await routes.availability.PUT(
        req(a.token, "/availability", "PUT", { drafts: [manual(2, "08:00", "07:00", "free")] }),
      ),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.issues[0].code).toBe("end_before_start");

    const saved = await routes.availability.PUT(req(a.token, "/availability", "PUT", { drafts: WEEK_AVAILABILITY }));
    expect(saved.status).toBe(200);

    const gen = await json(
      await routes.proposals.POST(
        req(a.token, "/schedule/proposals", "POST", { weekStart, settings: SETTINGS, useAi: true }),
      ),
    );
    expect(gen.status).toBe(200);
    expect(gen.body.data.ai.status).toBe("not_configured");
    expect(gen.body.data.proposal.source).toBe("deterministic");
    const sessions = gen.body.data.proposal.sessions;
    expect(sessions).toHaveLength(3);

    // A conflicting edit (into class time) is rejected by the server.
    const conflicting = sessions.map((s: { key: string }, i: number) => (i === 0 ? { ...s, startTime: "10:00" } : s));
    const check = await json(
      await routes.validate.POST(
        req(a.token, "/schedule/validate", "POST", { weekStart, settings: SETTINGS, sessions: conflicting }),
      ),
    );
    expect(check.body.data.valid).toBe(false);
    expect(check.body.data.violations[0].code).toBe("overlaps_busy");
    const refused = await json(
      await routes.plans.POST(
        req(a.token, "/schedule/plans", "POST", {
          weekStart,
          settings: SETTINGS,
          sessions: conflicting,
          source: "deterministic",
        }),
      ),
    );
    expect(refused.status).toBe(422);

    // A valid edit is accepted and approved.
    const edited = sessions.map((s: { key: string }, i: number) =>
      i === 0 ? { ...s, startTime: "06:30", plannedBy: "runner" } : s,
    );
    const approved = await json(
      await routes.plans.POST(
        req(a.token, "/schedule/plans", "POST", {
          weekStart,
          settings: SETTINGS,
          sessions: edited,
          source: "deterministic",
        }),
      ),
    );
    expect(approved.status).toBe(201);
    expect(approved.body.data.workouts).toHaveLength(3);
    expect(approved.body.data.workouts[0].startsAt).toBe(`${weekStart}T01:00:00.000Z`); // 06:30 IST

    // Approving again without replace is a conflict (no duplicates); with replace it supersedes.
    const again = await json(
      await routes.plans.POST(
        req(a.token, "/schedule/plans", "POST", {
          weekStart,
          settings: SETTINGS,
          sessions: edited,
          source: "deterministic",
        }),
      ),
    );
    expect(again.status).toBe(409);

    const fetched = await json(await routes.plans.GET(req(a.token, `/schedule/plans?weekStart=${weekStart}`)));
    expect(fetched.body.data.plan.id).toBe(approved.body.data.id);
    expect(fetched.body.data.latestSettings).toEqual(SETTINGS);

    // Other runners see nothing and cannot move the session.
    const other = await json(await routes.plans.GET(req(b.token, `/schedule/plans?weekStart=${weekStart}`)));
    expect(other.body.data.plan).toBeNull();
    const workoutId = approved.body.data.workouts[0].id;
    expect((await routes.reschedule.POST(req(b.token, `/x`, "POST"), params(workoutId))).status).toBe(404);

    // Missed-session rescheduling moves it to a valid slot and keeps the original as "rescheduled".
    const moved = await json(await routes.reschedule.POST(req(a.token, `/x`, "POST"), params(workoutId)));
    expect(moved.status).toBe(200);
    const statuses = moved.body.data.workouts.map((w: { status: string }) => w.status);
    expect(statuses.filter((s: string) => s === "rescheduled")).toHaveLength(1);
    expect(statuses.filter((s: string) => s === "planned")).toHaveLength(3);
    const replacement = moved.body.data.workouts.find(
      (w: { rescheduledFrom: string | null }) => w.rescheduledFrom === workoutId,
    );
    expect(replacement.startsAt).not.toBe(approved.body.data.workouts[0].startsAt);

    // The original cannot be moved twice.
    expect((await routes.reschedule.POST(req(a.token, `/x`, "POST"), params(workoutId))).status).toBe(409);
  });

  it("refuses to plan before any free time is confirmed", async () => {
    await routes.availability.PUT(
      req(b.token, "/availability", "PUT", { drafts: [manual(1, "09:00", "17:00", "busy")] }),
    );
    const gen = await json(
      await routes.proposals.POST(req(b.token, "/schedule/proposals", "POST", { weekStart, settings: SETTINGS })),
    );
    expect(gen.status).toBe(422);
    expect(gen.body.error.details.issues[0].code).toBe("no_free_time");
  });

  describe("with an AI provider configured (Case I)", () => {
    let aiRoutes: Routes;
    const realFetch = globalThis.fetch;
    let geminiCalls = 0;
    let geminiReply: () => Promise<Response> = async () => new Response("{}", { status: 500 });

    beforeAll(async () => {
      vi.resetModules();
      vi.stubEnv("AI_PROVIDER", "gemini");
      vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
      vi.stubEnv("AI_DAILY_CALL_LIMIT", "50");
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCalls++;
          return geminiReply();
        }
        return realFetch(input, init);
      });
      aiRoutes = await loadRoutes();
      await aiRoutes.availability.PUT(req(a.token, "/availability", "PUT", { drafts: WEEK_AVAILABILITY }));
    });

    afterAll(() => {
      vi.restoreAllMocks();
      vi.stubEnv("AI_PROVIDER", "none");
    });

    const generate = () =>
      aiRoutes.proposals.POST(
        req(a.token, "/schedule/proposals", "POST", { weekStart, settings: SETTINGS, useAi: true }),
      );

    it("falls back to a valid deterministic plan on provider auth failure, with one call", async () => {
      geminiCalls = 0;
      geminiReply = async () =>
        new Response(
          JSON.stringify({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } }),
          { status: 400 },
        );
      const r = await json(await generate());
      expect(r.status).toBe(200);
      expect(geminiCalls).toBe(1);
      expect(r.body.data.ai.status).toBe("failed");
      expect(r.body.data.proposal.source).toBe("deterministic");
      expect(r.body.data.proposal.sessions).toHaveLength(3);
    });

    it("rejects AI output that breaks scheduling rules and keeps the standard plan", async () => {
      geminiReply = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        sessions: [
                          { key: "s1", weekday: 1, startTime: "10:00", durationMinutes: 30, note: "x" },
                          { key: "s2", weekday: 2, startTime: "06:00", durationMinutes: 30, note: "x" },
                          { key: "s3", weekday: 3, startTime: "06:00", durationMinutes: 30, note: "x" },
                        ],
                        summary: "",
                        alternatives: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      const r = await json(await generate());
      expect(r.body.data.ai.status).toBe("rejected");
      expect(r.body.data.proposal.source).toBe("deterministic");
    });

    it("records AI usage without storing content", async () => {
      const { data } = await a.admin.from("ai_calls").select("*").eq("user_id", a.id);
      expect(data!.length).toBeGreaterThanOrEqual(2);
      // Usage metadata only (model name and token counts are numbers, not content).
      expect(Object.keys(data![0]).sort()).toEqual(
        [
          "created_at",
          "error_kind",
          "feature",
          "id",
          "input_tokens",
          "latency_ms",
          "model",
          "outcome",
          "output_tokens",
          "user_id",
        ].sort(),
      );
    });
  });
});
