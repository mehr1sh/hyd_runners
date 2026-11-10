/**
 * Local demo data orchestration (loaded by run.mjs; never imported by the app).
 *
 * seed  — create the sample accounts and their community, idempotently:
 *   1. accounts through the GoTrue admin API (fixed ids, app_metadata.demo);
 *   2. community.sql: clubs, group runs, events, squads, leagues, challenges,
 *      professionals, coaching, races (skipped if already present);
 *   3. GPS activities through the app's own import pipeline (GPX files that
 *      follow the two OpenStreetMap routes in the database) and manual
 *      workouts through the workout service (source = "simulated");
 *   4. rewards through the app's reward reconciliation;
 *   5. social.sql: reactions, comments, stories, race results (skipped if present);
 *   6. Meera's half-marathon plan, proposed and accepted through the same
 *      code and database function as the Training page, signed in as her.
 * reset — remove every demo account and everything they own or created.
 * check — consistency checks (check.sql).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET, processActivity, storagePathFor } from "@/features/activities/server/import";
import { logManualWorkout } from "@/features/workouts/service";
import { reconcileRewards } from "@/features/gamification/service";
import { addDays, localDate, weekStart, weekday, type LocalDate } from "@/features/gamification/logic/time";
import { buildRacePlanProposal } from "@/features/training/server/race-plan-proposal";
import { generateDemoPassword } from "@/features/dashboard/demo-seed";
import type { WorkoutType } from "@/lib/contracts";
import {
  DEMO_EMAIL_DOMAIN,
  KIND,
  MAIN_ACCOUNT,
  PEOPLE,
  byKey,
  demoId,
  displayNameFor,
  emailFor,
  personId,
  type DemoPerson,
} from "./people";
import { measure, rng, toGpx, trackPoints, type LonLat, type PacePlan } from "./gpx";

type Ctx = { psql: (sql: string) => string; sqlDir: string };
type Admin = SupabaseClient;

const TZ = "Asia/Kolkata";
const KBR_ROUTE = "5eed0005-0000-4000-8000-000000000001";
const BACHUPALLY_ROUTE = "5eed0005-0000-4000-8000-000000000002";
const KBR_LOCATION = "5eed0001-0000-4000-8000-000000000001";
const at = (date: LocalDate, time: string) => new Date(`${date}T${time}:00+05:30`);
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

export async function run(command: "seed" | "reset" | "check", ctx: Ctx) {
  const admin = createAdminClient();
  if (command === "reset") return reset(admin, ctx);
  if (command === "check") {
    process.stdout.write(ctx.psql(readFileSync(join(ctx.sqlDir, "check.sql"), "utf8")));
    return;
  }
  await seed(admin, ctx);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function ensureAccounts(admin: Admin, password: string) {
  for (const p of PEOPLE) {
    const id = personId(p);
    const email = emailFor(p);
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user) {
      if (data.user.app_metadata?.demo !== true || data.user.email !== email)
        throw new Error(`User ${id} exists and is not the demo account ${email}; refusing to modify it.`);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`Could not update ${email}: ${error.message}`);
      continue;
    }
    const { error } = await admin.auth.admin.createUser({
      id,
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayNameFor(p) },
      app_metadata: { demo: true },
    });
    if (error)
      throw new Error(`Could not create ${email} (is that address already used by another account?): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// History plans
// ---------------------------------------------------------------------------

type GpsSpec = {
  id: string;
  person: DemoPerson;
  start: Date;
  distanceM: number;
  plan: PacePlan;
  name: string;
  type: "run" | "walk_run" | "walk";
  visibility: "public" | "followers" | "private";
  route: "kbr" | "bachupally";
};

type ManualSpec = {
  key: string;
  person: DemoPerson;
  date: LocalDate;
  time: string;
  minutes: number;
  km: number | null;
  type: Exclude<WorkoutType, "rest">;
  title: string;
  locationId: string | null;
  effort: number;
  link?: { enrollmentId: string; sessionId: string };
};

type Attendance = {
  userId: string;
  date: LocalDate;
  time: string;
  eventId: string;
  seriesId: string | null;
  title: string;
  locationId: string | null;
};

const SERIES_RUN: Record<number, { km: (weeksAgo: number) => number; paceFactor: number; type: "run" | "walk_run" }> = {
  1: { km: () => 8, paceFactor: 1.02, type: "run" }, // Saturday lake loop
  2: { km: (w) => [18, 16, 16, 14][w - 1] ?? 14, paceFactor: 1.04, type: "run" }, // Sunday long run
  3: { km: () => 7, paceFactor: 0.97, type: "run" }, // Wednesday track session
  4: { km: () => 3.4, paceFactor: 1, type: "walk_run" }, // Tuesday beginners
};

async function loadAttendance(admin: Admin): Promise<Attendance[]> {
  const ids = PEOPLE.map(personId);
  const { data, error } = await admin
    .from("event_rsvps")
    .select("user_id, checked_in_at, events!inner(id, starts_at, series_id, title, location_id)")
    .in("user_id", ids)
    .not("checked_in_at", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const e = r.events as unknown as {
      id: string;
      starts_at: string;
      series_id: string | null;
      title: string;
      location_id: string | null;
    };
    const start = new Date(e.starts_at);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(start);
    return {
      userId: r.user_id as string,
      date: localDate(start, TZ),
      time: local,
      eventId: e.id,
      seriesId: e.series_id,
      title: e.title.replace(/^Sample: /, ""),
      locationId: e.location_id,
    };
  });
}

/** Series number (1–4) from a demo series id. */
const seriesNumber = (id: string | null) => (id ? Number(id.slice(-12)) : 0);

function buildPlans(anchor: LocalDate, now: Date, attendance: Attendance[]) {
  const today = localDate(now, TZ);
  const gps: GpsSpec[] = [];
  const manual: ManualSpec[] = [];
  const busy = new Map<string, Set<LocalDate>>();
  const mark = (uid: string, d: LocalDate) => (busy.get(uid) ?? busy.set(uid, new Set()).get(uid)!).add(d);
  const isBusy = (uid: string, d: LocalDate) => busy.get(uid)?.has(d) ?? false;
  // Before the first seed day (the anchor) and finished by now, so re-runs on later days add nothing.
  const inPast = (d: LocalDate, time: string) =>
    d <= anchor && (d < today || (d === today && at(d, time).getTime() < now.getTime() - 90 * 60_000));
  const timeTrial = demoId(KIND.event, 1);

  for (const a of attendance) mark(a.userId, a.date);

  for (const p of PEOPLE) {
    const uid = personId(p);
    const rand = rng(p.n * 7919);
    const mine = attendance.filter((a) => a.userId === uid);
    let m = 0;

    // Group runs they checked in at (not the time trial, which has a GPS file).
    for (const a of mine) {
      if (a.eventId === timeTrial || !a.seriesId) continue;
      const s = SERIES_RUN[seriesNumber(a.seriesId)];
      if (!s) continue;
      const weeksAgo = Math.max(1, Math.round((Date.parse(today) - Date.parse(a.date)) / (7 * 86_400_000)));
      const novice = p.kind !== "runner";
      const km = novice ? 3.2 : s.km(weeksAgo);
      const pace = novice ? 560 : (p.easyPace ?? 420) * s.paceFactor;
      manual.push({
        key: demoId(KIND.workout, p.n * 10_000 + ++m),
        person: p,
        date: a.date,
        time: clock(toMinutes(a.time) + 5),
        minutes: Math.max(10, Math.round((km * pace) / 60)),
        km: Math.round(km * 100) / 100,
        type: novice ? "walk_run" : s.type,
        title: `Group run: ${a.title}`,
        locationId: a.locationId,
        effort: novice ? 5 : 4 + (seriesNumber(a.seriesId) === 3 ? 3 : 0),
      });
    }

    if (p.kind === "runner" && p.easyPace && p.route) {
      const easy = p.easyPace;
      // The time trial, as a GPS file at race effort.
      const tt = mine.find((a) => a.eventId === timeTrial);
      if (tt) {
        const race = easy * 0.86;
        gps.push({
          id: demoId(KIND.activity, p.n * 1000 + 999),
          person: p,
          start: new Date(at(tt.date, "06:00").getTime() + (2 + Math.floor(rand() * 3)) * 60_000),
          distanceM: 10_000,
          plan: [
            { untilM: 5000, pace: race * 1.01 },
            { untilM: Infinity, pace: race * 0.99 },
          ],
          name: "KBR 10K time trial",
          type: "run",
          visibility: "public",
          route: "kbr",
        });
      }
      const pattern = p.perWeek === 3 ? (p.route === "bachupally" ? [1, 3, 6] : [2, 4, 7]) : [3, 7];
      const weeks = p.weeks ?? 4;
      let k = 0;
      for (let w = weeks - 1; w >= 0; w--) {
        const monday = weekStart(addDays(anchor, -7 * w));
        for (const dow of pattern) {
          let date = addDays(monday, dow - 1);
          const time = clock(5 * 60 + 40 + Math.floor(rand() * 35));
          if (isBusy(uid, date)) date = addDays(date, 1);
          if (isBusy(uid, date) || !inPast(date, time) || (weekday(date) !== dow && pattern.includes(weekday(date))))
            continue;
          k++;
          let kind: "easy" | "long" | "tempo" | "intervals" = "easy";
          if (dow === 7) kind = "long";
          else if (p.route === "bachupally" && dow === 3) kind = "intervals";
          else if (dow === 4 && p.perWeek === 3) kind = "tempo";
          const spec = gpsSpec(p, kind, k, date, time, weeks - 1 - w, rand);
          gps.push(spec);
          mark(uid, date);
        }
      }
    }

    // Beginners: programme sessions or walks, without GPS.
    if (p.kind === "c25k" || p.kind === "return" || p.kind === "walker") {
      const days = p.kind === "walker" ? [1, 3, 6] : [1, 3, 5];
      const span = p.kind === "c25k" ? 24 : p.kind === "return" ? 33 : 20;
      for (let d = span; d >= 0; d--) {
        const date = addDays(anchor, -d);
        const time = p.kind === "c25k" ? "07:00" : "07:15";
        if (!days.includes(weekday(date)) || isBusy(uid, date) || !inPast(date, time)) continue;
        manual.push({
          key: demoId(KIND.workout, p.n * 10_000 + ++m),
          person: p,
          date,
          time,
          minutes: p.kind === "walker" ? 35 + Math.floor(rand() * 10) : 30,
          km: p.kind === "walker" ? 3.4 + Math.round(rand() * 6) / 10 : p.kind === "c25k" ? 3.1 + m * 0.05 : 3.4,
          type: p.kind === "walker" ? "walk" : "walk_run",
          title: p.kind === "walker" ? "Morning walk at KBR" : "Programme session",
          locationId: KBR_LOCATION,
          effort: p.kind === "walker" ? 3 : 5 + (m % 3),
          link:
            p.kind === "walker" ? undefined : { enrollmentId: demoId(18, p.kind === "c25k" ? 1 : 2), sessionId: "" },
        });
        mark(uid, date);
      }
    }
  }
  return { gps, manual };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function gpsSpec(
  p: DemoPerson,
  kind: "easy" | "long" | "tempo" | "intervals",
  k: number,
  date: LocalDate,
  time: string,
  weekIndex: number,
  rand: () => number,
): GpsSpec {
  const easy = p.easyPace!;
  const start = at(date, time);
  const id = demoId(KIND.activity, p.n * 1000 + k);
  const visibility: GpsSpec["visibility"] =
    p.key === "meera" ? (k % 5 === 0 ? "followers" : "public") : k % 3 === 0 ? "public" : "followers";
  const base = { id, person: p, start, type: "run" as const, visibility, route: p.route! };
  if (kind === "long") {
    const km = p.key === "meera" ? Math.min(17, 10 + weekIndex * 1) : Math.round((easy < 360 ? 14 : 11) + rand() * 3);
    return { ...base, distanceM: km * 1000, plan: [{ untilM: Infinity, pace: easy * 1.04 }], name: "Sunday long run" };
  }
  if (kind === "tempo") {
    const d = 8000;
    return {
      ...base,
      distanceM: d,
      plan: [
        { untilM: 2000, pace: easy },
        { untilM: d - 2000, pace: easy * 0.88 },
        { untilM: Infinity, pace: easy * 1.02 },
      ],
      name: "Tempo run",
    };
  }
  if (kind === "intervals") {
    const plan: PacePlan = [{ untilM: 2000, pace: easy }];
    let s = 2000;
    for (let i = 0; i < 6; i++) {
      plan.push({ untilM: (s += 800), pace: easy * 0.8 });
      plan.push({ untilM: (s += 400), pace: easy * 1.25 });
    }
    plan.push({ untilM: Infinity, pace: easy * 1.05 });
    return { ...base, distanceM: s + 1500, plan, name: "Track intervals: 6 × 800 m" };
  }
  const minutes = 35 + Math.floor(rand() * 15);
  const distanceM = Math.round(((minutes * 60) / easy) * 1000);
  return {
    ...base,
    distanceM,
    plan: [{ untilM: Infinity, pace: easy }],
    name: p.route === "bachupally" ? "Easy laps at Bachupally" : "Easy run at KBR",
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

function routeGeometry(ctx: Ctx, id: string): LonLat[] {
  const out = ctx.psql(`select st_asgeojson(path::geometry) from public.routes where id = '${id}';`).trim();
  if (!out) throw new Error(`Route ${id} is missing; run the migrations first.`);
  return JSON.parse(out).coordinates as LonLat[];
}

async function importGps(admin: Admin, ctx: Ctx, specs: GpsSpec[], now: Date) {
  const routes = {
    kbr: { m: measure(routeGeometry(ctx, KBR_ROUTE)), loop: false },
    bachupally: { m: measure(routeGeometry(ctx, BACHUPALLY_ROUTE)), loop: true },
  };
  let created = 0;
  for (const s of specs) {
    const uid = personId(s.person);
    const { data: existing } = await admin.from("activities").select("status").eq("id", s.id).maybeSingle();
    if (existing?.status === "ready") continue;
    if (existing) {
      await admin.storage.from(BUCKET).remove([storagePathFor(uid, s.id)]);
      await admin.from("activities").delete().eq("id", s.id);
    }
    const r = routes[s.route];
    const points = trackPoints({
      route: r.m,
      loop: r.loop,
      start: s.start,
      distanceM: s.distanceM,
      plan: s.plan,
      seed: Number.parseInt(s.id.slice(-8), 10),
    });
    if (points[points.length - 1].t.getTime() > now.getTime()) continue;
    const bytes = new TextEncoder().encode(toGpx(s.name, points));
    const { error: insertError } = await admin
      .from("activities")
      .insert({ id: s.id, user_id: uid, activity_type: s.type, visibility: s.visibility, name: s.name });
    if (insertError) throw new Error(`Could not register activity ${s.id}: ${insertError.message}`);
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePathFor(uid, s.id), bytes, { contentType: "application/gpx+xml", upsert: true });
    if (uploadError) throw new Error(`Could not upload activity ${s.id}: ${uploadError.message}`);
    const result = await processActivity(uid, s.id, admin);
    if (result.status !== "ready")
      throw new Error(`Activity ${s.id} (${s.person.key}, ${s.name}) did not import: ${JSON.stringify(result)}`);
    created++;
  }
  return created;
}

async function logManual(admin: Admin, specs: ManualSpec[], now: Date) {
  // Programme sessions are taken in order, one per logged day.
  const sessionsFor = new Map<string, string[]>();
  for (const enrollmentId of new Set(specs.flatMap((s) => (s.link ? [s.link.enrollmentId] : [])))) {
    const { data: enrollment } = await admin.from("enrollments").select("programme_id").eq("id", enrollmentId).single();
    const { data: sessions } = await admin
      .from("programme_sessions")
      .select("id, week, day")
      .eq("programme_id", enrollment!.programme_id)
      .order("week")
      .order("day");
    sessionsFor.set(
      enrollmentId,
      (sessions ?? []).map((x) => x.id as string),
    );
  }
  const used = new Map<string, number>();
  let created = 0;
  for (const s of specs) {
    let link: { kind: "programme"; enrollmentId: string; sessionId: string } | undefined;
    if (s.link) {
      const i = used.get(s.link.enrollmentId) ?? 0;
      const sessionId = sessionsFor.get(s.link.enrollmentId)?.[i];
      used.set(s.link.enrollmentId, i + 1);
      if (sessionId) link = { kind: "programme", enrollmentId: s.link.enrollmentId, sessionId };
    }
    const result = await logManualWorkout(
      personId(s.person),
      {
        title: s.title,
        workoutType: s.type,
        startedAt: at(s.date, s.time).toISOString(),
        durationMinutes: s.minutes,
        distanceKm: s.km,
        perceivedEffort: s.effort,
        notes: null,
        locationId: s.locationId,
        idempotencyKey: s.key,
        link,
      },
      { allowBackdate: true, source: "simulated", now, reconcile: false },
      admin,
    );
    if (!result.alreadyCompleted) created++;
  }
  return created;
}

async function proposeAndAcceptPlan(admin: Admin, password: string, now: Date) {
  const uid = personId(MAIN_ACCOUNT);
  const { data: existing } = await admin
    .from("training_proposals")
    .select("id")
    .eq("user_id", uid)
    .eq("kind", "race_plan")
    .limit(1);
  if (existing?.length) return false;
  // Signed in as Meera, so row-level security and the database functions
  // treat this exactly like her pressing "Generate plan" and "Accept".
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email: emailFor(MAIN_ACCOUNT), password });
  if (signInError) throw new Error(`Could not sign in as the demo runner: ${signInError.message}`);
  const built = await buildRacePlanProposal(client, uid, TZ, localDate(now, TZ));
  if ("error" in built) throw new Error(`Race plan: ${built.error}`);
  const { data: row, error } = await client.from("training_proposals").insert(built.row).select("id").single();
  if (error) throw new Error(`Race plan: ${error.message}`);
  const decided = await client.rpc("decide_training_proposal", { p_id: row.id, p_accept: true, p_skip: [] });
  if (decided.error) throw new Error(`Race plan: ${decided.error.message}`);
  await client.auth.signOut();
  return true;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const exists = async (admin: Admin, table: string, id: string) => {
  const { data, error } = await admin.from(table).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return Boolean(data);
};

async function seed(admin: Admin, ctx: Ctx) {
  const now = new Date();
  const password = generateDemoPassword();
  const step = (msg: string) => console.log(`• ${msg}`);

  step(`Accounts: ${PEOPLE.length} sample people (@${DEMO_EMAIL_DOMAIN})`);
  await ensureAccounts(admin, password);

  if (await exists(admin, "clubs", demoId(KIND.club, 1))) step("Community: already seeded, skipped");
  else {
    ctx.psql(readFileSync(join(ctx.sqlDir, "community.sql"), "utf8"));
    step("Community: clubs, group runs, events, squads, leagues, challenges, professionals, coaching");
  }

  const { data: tt, error: ttError } = await admin
    .from("events")
    .select("starts_at")
    .eq("id", demoId(KIND.event, 1))
    .maybeSingle();
  if (ttError) throw new Error(`Could not read the demo time trial: ${ttError.message}`);
  if (!tt) throw new Error("The demo time trial is missing; run `pnpm demo:reset` and seed again.");
  // Every date is relative to the day the community was first seeded, so re-runs add nothing new.
  const anchor = addDays(localDate(new Date(tt.starts_at as string), TZ), 24);
  const { gps, manual } = buildPlans(anchor, now, await loadAttendance(admin));
  const loggedManual = await logManual(admin, manual, now);
  step(`Workouts: ${manual.length} without GPS (${loggedManual} new)`);
  const imported = await importGps(admin, ctx, gps, now);
  step(`Activities: ${gps.length} GPS files through the import pipeline (${imported} new)`);

  for (const p of PEOPLE) await reconcileRewards(personId(p), admin);
  step("Rewards: XP, badges and challenge completions reconciled");

  if (await exists(admin, "activity_comments", demoId(24, 1))) step("Social: already seeded, skipped");
  else {
    ctx.psql(readFileSync(join(ctx.sqlDir, "social.sql"), "utf8"));
    step("Social: reactions, comments, stories, race results, coach notes");
  }

  if (await proposeAndAcceptPlan(admin, password, now))
    step("Training: Meera's half-marathon plan proposed and accepted");
  else step("Training: plan already in place, skipped");

  console.log(`
Demo data is ready (local only). Sign in at http://localhost:3000/sign-in:
  ${emailFor(MAIN_ACCOUNT)} — runner with a full history
  ${emailFor(byKey("sandeep"))} — coach (Coach dashboard)
  ${emailFor(byKey("team"))} — programme manager and admin
  Password for every demo account (new on each run): ${password}
All demo accounts use @${DEMO_EMAIL_DOMAIN}. Remove everything with \`pnpm demo:reset\`.`);
}

async function reset(admin: Admin, ctx: Ctx) {
  ctx.psql(readFileSync(join(ctx.sqlDir, "reset.sql"), "utf8"));
  let removed = 0;
  for (const p of PEOPLE) {
    const id = personId(p);
    const { data } = await admin.auth.admin.getUserById(id);
    if (!data?.user) continue;
    if (data.user.app_metadata?.demo !== true)
      throw new Error(`User ${id} is not a demo account; refusing to delete it.`);
    const { data: files } = await admin.storage.from(BUCKET).list(id, { limit: 1000 });
    if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`Could not delete ${emailFor(p)}: ${error.message}`);
    removed++;
  }
  console.log(
    `Removed ${removed} demo accounts and everything they created. Audit-log entries stay (the log is append-only).`,
  );
}
