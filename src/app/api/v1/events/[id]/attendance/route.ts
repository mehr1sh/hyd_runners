import { z } from "zod";
import { fail } from "@/lib/api/response";
import { requireCaller } from "@/features/scheduler/server/api";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** GET /api/v1/events/[id]/attendance: CSV of the roster for the event team (event_roster enforces access). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/events/[id]/attendance">) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", "Event not found.");
  const [roster, results] = await Promise.all([
    auth.caller.supabase.rpc("event_roster", { p_event_id: id }),
    auth.caller.supabase.from("event_results").select("user_id, outcome, finish_seconds").eq("event_id", id),
  ]);
  if (roster.error)
    return roster.error.code === "42501"
      ? fail("forbidden", "Event team only.")
      : fail("internal_error", "Could not load the roster.");
  const res = new Map(
    ((results.data ?? []) as { user_id: string; outcome: string; finish_seconds: number | null }[]).map((r) => [
      r.user_id,
      r,
    ]),
  );
  const lines = [
    ["user_id", "name", "status", "checked_in_at", "team_role", "outcome", "finish_seconds"].join(","),
    ...((roster.data ?? []) as Record<string, unknown>[]).map((r) => {
      const result = res.get(r.user_id as string);
      return [
        r.user_id,
        r.display_name,
        r.status,
        r.checked_in_at,
        r.team_role,
        result?.outcome,
        result?.finish_seconds,
      ]
        .map(csv)
        .join(",");
    }),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${id.slice(0, 8)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
