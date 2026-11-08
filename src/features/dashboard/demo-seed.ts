import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkoutType } from "@/lib/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileRewards } from "@/features/gamification/service";
import { addDays, localDate } from "@/features/gamification/logic/time";
import { logManualWorkout } from "@/features/workouts/service";

/**
 * Builds clearly labelled demonstration accounts. All history is created
 * through the real workout and reward services (source = "simulated"), so
 * every number on the demo dashboard follows the documented rules. Only
 * accounts flagged `user_metadata.demo = true` are ever modified.
 */

/**
 * A fresh random password (144 bits, URL-safe) for each seed run. There is no
 * fixed demo password: the demo runner's password is returned once, to the
 * authorised caller, and the sample runners' passwords are never returned.
 */
export function generateDemoPassword() {
  return randomBytes(18).toString("base64url");
}

export const DEMO_RUNNER = { email: "demo.runner@hydrunners.test", displayName: "Demo Runner (sample)" };
const SAMPLE_RUNNERS = [
  { email: "sample.lakshmi@hydrunners.test", displayName: "Lakshmi (sample)", sessions: 3 },
  { email: "sample.rahul@hydrunners.test", displayName: "Rahul (sample)", sessions: 2 },
  { email: "sample.fatima@hydrunners.test", displayName: "Fatima (sample)", sessions: 1 },
];
const TZ = "Asia/Kolkata";

async function upsertDemoUser(admin: SupabaseClient, email: string, displayName: string, password: string) {
  const { data: page, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const existing = page.users.find((u) => u.email === email);
  if (existing) {
    if (existing.user_metadata?.demo !== true)
      throw new Error(`${email} exists and is not a demo account; refusing to modify it.`);
    // Reset its history so the seed is repeatable.
    for (const table of [
      "workout_logs",
      "xp_ledger",
      "user_badges",
      "challenge_completions",
      "event_rsvps",
      "enrollments",
    ]) {
      const { error: e } = await admin.from(table).delete().eq("user_id", existing.id);
      if (e) throw new Error(e.message);
    }
    // Rotate the password: earlier runs' passwords stop working.
    const { error: passwordError } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (passwordError) throw new Error(passwordError.message);
    return existing.id;
  }
  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, demo: true },
  });
  if (createError) throw new Error(createError.message);
  return data.user.id;
}

/** ISO instant for a local date at a local time in Asia/Kolkata. */
const at = (date: string, time: string) => `${date}T${time}:00+05:30`;

export async function seedDemoData(now = new Date()) {
  const admin = createAdminClient();
  const today = localDate(now, TZ);

  // 1. Demo runner: three weeks into Couch to 5K, plus some general fitness.
  const demoPassword = generateDemoPassword();
  const demoId = await upsertDemoUser(admin, DEMO_RUNNER.email, DEMO_RUNNER.displayName, demoPassword);
  const { data: c25k } = await admin
    .from("programmes")
    .select("id, programme_sessions(id, week, day)")
    .eq("slug", "couch-to-5k")
    .single();
  if (!c25k) throw new Error("Couch to 5K programme missing; run the migrations first.");
  const sessions = (c25k.programme_sessions as { id: string; week: number; day: number }[]).sort(
    (a, b) => a.week - b.week || a.day - b.day,
  );

  // Sessions every other day, ending two days ago, so today is a run day.
  const runs = 7;
  const firstDay = addDays(today, -2 - (runs - 1) * 2);
  const { data: enrollment, error: enrollError } = await admin
    .from("enrollments")
    .insert({ user_id: demoId, programme_id: c25k.id, started_at: at(firstDay, "06:00") })
    .select("id")
    .single();
  if (enrollError) throw new Error(enrollError.message);

  const logs: {
    date: string;
    time: string;
    minutes: number;
    km: number | null;
    type: WorkoutType;
    title: string;
    sessionId?: string;
    effort: number;
  }[] = [];
  for (let i = 0; i < runs; i++) {
    const s = sessions[i];
    logs.push({
      date: addDays(firstDay, i * 2),
      time: i % 2 ? "18:15" : "06:30",
      minutes: 30,
      km: 3 + i * 0.15,
      type: "walk_run",
      title: "",
      sessionId: s.id,
      effort: 5 + (i % 3),
    });
  }
  logs.push({
    date: addDays(firstDay, 3),
    time: "19:00",
    minutes: 25,
    km: null,
    type: "mobility",
    title: "Yoga for runners: hip flow",
    effort: 3,
  });
  logs.push({
    date: addDays(firstDay, 9),
    time: "19:00",
    minutes: 25,
    km: null,
    type: "strength",
    title: "Upper-body basics",
    effort: 6,
  });

  let n = 0;
  for (const l of logs) {
    await logManualWorkout(
      demoId,
      {
        title: l.title || "Couch to 5K session",
        workoutType: l.type as Exclude<WorkoutType, "rest">,
        startedAt: at(l.date, l.time),
        durationMinutes: l.minutes,
        distanceKm: l.km === null ? null : Math.round(l.km * 100) / 100,
        perceivedEffort: l.effort,
        notes: null,
        locationId: null,
        idempotencyKey: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
        link: l.sessionId ? { kind: "programme", enrollmentId: enrollment.id, sessionId: l.sessionId } : undefined,
      },
      { allowBackdate: true, source: "simulated", now, reconcile: false },
      admin,
    );
  }

  // RSVP to the first upcoming published event, if any.
  const { data: event } = await admin
    .from("events")
    .select("id")
    .eq("status", "published")
    .gte("ends_at", now.toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  if (event) await admin.from("event_rsvps").upsert({ event_id: event.id, user_id: demoId, status: "going" });
  await reconcileRewards(demoId, admin);

  // 2. Sample runners with activity this week, so the leaderboard has company.
  for (const r of SAMPLE_RUNNERS) {
    const id = await upsertDemoUser(admin, r.email, r.displayName, generateDemoPassword());
    for (let i = 0; i < r.sessions; i++) {
      const date = addDays(today, -i * 2);
      await logManualWorkout(
        id,
        {
          title: "Easy run",
          workoutType: "run",
          startedAt: at(date, "06:00"),
          durationMinutes: 20 + i * 10,
          distanceKm: 3 + i,
          perceivedEffort: 5,
          notes: null,
          locationId: null,
          idempotencyKey: crypto.randomUUID(),
        },
        { allowBackdate: true, source: "simulated", now, reconcile: false },
        admin,
      );
    }
    await reconcileRewards(id, admin);
  }

  return {
    demoEmail: DEMO_RUNNER.email,
    demoPassword,
    sampleRunners: SAMPLE_RUNNERS.map((r) => r.email),
  };
}
