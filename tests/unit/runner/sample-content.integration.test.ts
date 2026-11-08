/**
 * The sample running plans (migration 20261108150000) read through the public
 * Data API against the LOCAL Supabase stack, checked with the app's own
 * contracts. Invalid blocks would otherwise be shown as an empty session.
 * Skipped when .env.local / local Supabase is absent.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { WorkoutBlock, TrainingProgramme } from "@/lib/contracts";
import { programmeProgress } from "@/features/workouts/logic/programme-progress";
import { isLocalSupabaseUrl } from "../local-supabase";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no local env */
  }
  return (
    isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

const enabled = loadEnv();
async function reachable() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

type SessionRow = {
  id: string;
  week: number;
  day: number;
  title: string;
  workout_type: string;
  estimated_minutes: number;
  blocks: unknown;
};

describe.skipIf(!enabled)("sample running plans (local Supabase)", async () => {
  const up = enabled && (await reachable());
  if (!up) {
    it.skip("local Supabase is not running", () => {});
    return;
  }
  // Signed out, exactly as the public programmes pages read them.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon
    .from("programmes")
    .select(
      "id, slug, title, summary, kind, category, level, duration_weeks, sessions_per_week, published, owner_id, programme_sessions(id, week, day, title, workout_type, estimated_minutes, blocks)",
    )
    .eq("category", "running")
    .order("sort_order");
  if (error) throw error;
  const plans = data ?? [];

  it("publishes the eight running plans", () => {
    expect(plans.map((p) => p.slug)).toEqual([
      "walk-to-run-foundation",
      "consistency-habit-builder",
      "return-to-running",
      "5k-improvement",
      "10k-preparation",
      "endurance-base",
      "half-marathon-foundation",
      "half-marathon-advanced",
    ]);
    expect(new Set(plans.map((p) => p.category))).toEqual(new Set(["running"]));
  });

  it("matches the app's programme and block contracts", () => {
    for (const plan of plans) {
      expect(() =>
        TrainingProgramme.parse({
          id: plan.id,
          slug: plan.slug,
          title: plan.title,
          summary: plan.summary,
          kind: plan.kind,
          level: plan.level,
          durationWeeks: plan.duration_weeks,
          sessionsPerWeek: plan.sessions_per_week,
          published: plan.published,
          ownerId: plan.owner_id,
        }),
      ).not.toThrow();
      for (const session of plan.programme_sessions as SessionRow[]) {
        const parsed = WorkoutBlock.array().min(1).safeParse(session.blocks);
        expect(parsed.success, `${plan.slug} ${session.title}`).toBe(true);
      }
    }
  });

  it("works with programme progress and rest days", () => {
    for (const plan of plans) {
      const sessions = (plan.programme_sessions as SessionRow[]).map((s) => ({
        id: s.id,
        week: s.week,
        day: s.day,
        title: s.title,
        workoutType: s.workout_type,
        estimatedMinutes: s.estimated_minutes,
      }));
      const fresh = programmeProgress({
        sessions,
        completed: [],
        today: "2026-11-09",
        durationWeeks: plan.duration_weeks,
      });
      expect(fresh).toMatchObject({
        total: plan.duration_weeks * plan.sessions_per_week,
        completed: 0,
        finished: false,
      });
      expect(fresh.next).toMatchObject({ week: 1 });

      // After the first session, the plan asks for a rest day before the next one.
      const afterFirst = programmeProgress({
        sessions,
        completed: [{ sessionId: fresh.next!.id, localDate: "2026-11-09" }],
        today: "2026-11-09",
        durationWeeks: plan.duration_weeks,
      });
      expect(afterFirst).toMatchObject({ completed: 1, restRecommended: true, nextRecommendedDate: "2026-11-11" });
    }
  });
});
