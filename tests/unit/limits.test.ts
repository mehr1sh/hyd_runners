import { describe, expect, it, vi } from "vitest";
import { dbFailure, fetchAllPages } from "@/features/shared/db";
import { buildAchievementSummary } from "@/features/gamification/logic/summary";
import { isMissingSchemaError } from "@/lib/supabase/errors";

describe("fetchAllPages", () => {
  it("keeps reading until a short page, so results are never cut at the API cap", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const page = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }));
    await expect(fetchAllPages(page, 1000)).resolves.toEqual(all);
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after an exactly full last page with one empty read", async () => {
    const page = vi.fn(async (from: number) => ({ data: from === 0 ? [1, 2] : [], error: null }));
    await expect(fetchAllPages(page, 2)).resolves.toEqual([1, 2]);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws on a database error instead of returning a partial list", async () => {
    const page = async () => ({ data: null, error: { message: "timeout", code: "57014", details: "", hint: "" } });
    await expect(fetchAllPages(page as never)).rejects.toThrow("timeout");
  });
});

describe("achievement summary from database aggregates", () => {
  it("accepts totals and active dates instead of raw rows", () => {
    const built = buildAchievementSummary({
      userId: "u",
      totals: { xp: 5000, coins: 40 },
      activeDates: ["2026-11-06", "2026-11-07", "2026-11-08"],
      badges: [],
      timezone: "Asia/Kolkata",
      today: "2026-11-08",
    });
    expect(built.summary.totalXp).toBe(5000);
    expect(built.summary.coins).toBe(40);
    expect(built.summary.currentStreakDays).toBe(3);
  });

  it("matches the row-based calculation", () => {
    const fromRows = buildAchievementSummary({
      userId: "u",
      ledger: [
        { deltaXp: 30, deltaCoins: 3 },
        { deltaXp: 20, deltaCoins: 2 },
      ],
      workouts: [{ startedAt: "2026-11-08T01:00:00.000Z", durationSeconds: 1800 }],
      badges: [],
      timezone: "Asia/Kolkata",
      today: "2026-11-08",
    });
    const fromTotals = buildAchievementSummary({
      userId: "u",
      totals: { xp: 50, coins: 5 },
      activeDates: ["2026-11-08"],
      badges: [],
      timezone: "Asia/Kolkata",
      today: "2026-11-08",
    });
    expect(fromTotals.summary).toEqual(fromRows.summary);
  });
});

describe("database error mapping", () => {
  const err = (code: string) => ({ code, message: "x", details: "", hint: "", name: "PostgrestError" }) as never;

  it("turns rate limits into a clear rate_limited result", () => {
    expect(dbFailure(err("PT429"), "fallback")).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("turns invalid values (e.g. an unknown timezone) into validation errors", () => {
    expect(dbFailure(err("22023"), "fallback")).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("treats functions and columns from unapplied migrations as missing schema", () => {
    for (const code of ["PGRST202", "42883", "42703"]) expect(isMissingSchemaError({ code })).toBe(true);
    expect(isMissingSchemaError({ code: "PT429" })).toBe(false);
  });
});
