/**
 * Vercel deploys a merge before the protected workflow applies its migration.
 * Until then, columns added by the moderation migration do not exist; reading
 * messages and feedback must keep working without them.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Query, type QueryResult } from "./dashboard/fake-supabase";

vi.mock("server-only", () => ({}));
const { listMessages, listFeedback } = await import("@/features/community/service");

const missingColumn = (table: string): QueryResult => ({
  data: null,
  error: { message: `column ${table}.hidden_at does not exist`, code: "42703" },
});
const asksForHidden = (q: Query) =>
  q.calls.some((c) => c.method === "select" && String(c.args[0]).includes("hidden_at"));

describe("before the moderation migration is applied", () => {
  it("still lists messages", async () => {
    const client = fakeSupabase({
      messages: (q) =>
        asksForHidden(q)
          ? missingColumn("messages")
          : {
              data: [
                {
                  id: "m1",
                  sender_id: "u2",
                  recipient_id: "user-1",
                  body: "Hello",
                  created_at: "2026-11-08T10:00:00Z",
                },
              ],
              error: null,
            },
      content_reports: { data: null, error: { message: "relation does not exist", code: "42P01" } },
    });
    const result = await listMessages(client as never, "user-1");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.map((m) => [m.body, m.hidden, m.reported])).toEqual([["Hello", false, false]]);
  });

  it("still lists feedback with its replies", async () => {
    const client = fakeSupabase({
      feedback: {
        data: [
          {
            id: "f1111111-1111-4111-8111-111111111111",
            user_id: "a1111111-1111-4111-8111-111111111111",
            target: "app",
            target_id: null,
            rating: null,
            body: "Hard to keep going",
            status: "new",
            barrier: "motivation",
            assigned_to: null,
            created_at: "2026-11-08T10:00:00Z",
            updated_at: "2026-11-08T10:00:00Z",
          },
        ],
        error: null,
      },
      feedback_replies: (q) =>
        asksForHidden(q)
          ? missingColumn("feedback_replies")
          : {
              data: [
                {
                  id: "r1",
                  feedback_id: "f1111111-1111-4111-8111-111111111111",
                  author_id: "c1",
                  body: "We can help",
                  created_at: "2026-11-08T11:00:00Z",
                },
              ],
              error: null,
            },
    });
    const result = await listFeedback(client as never, "a1111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0].replies.map((r) => [r.body, r.hidden])).toEqual([["We can help", false]]);
  });
});
