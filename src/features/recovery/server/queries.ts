import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import { addDays, localDate, localMidnightUtc, type LocalDate } from "@/features/gamification/logic/time";
import type { DayLoad, Entry } from "../logic/readiness";
import type { LoggedExercise } from "../logic/muscles";

function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

export type JournalEntry = Entry & {
  id: string;
  sorenessAreas: string[];
  recoveryActivities: string[];
  notes: string | null;
  shareWithCoach: boolean;
};

export function toEntry(r: Record<string, unknown>): JournalEntry {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id as string,
    date: r.entry_date as string,
    sleepQuality: n(r.sleep_quality),
    sleepHours: n(r.sleep_hours),
    fatigue: n(r.fatigue),
    soreness: n(r.soreness),
    stress: n(r.stress),
    energy: n(r.energy),
    workoutRpe: n(r.workout_rpe),
    sorenessAreas: (r.soreness_areas as string[]) ?? [],
    recoveryActivities: (r.recovery_activities as string[]) ?? [],
    notes: (r.notes as string | null) ?? null,
    shareWithCoach: Boolean(r.share_with_coach),
  };
}

export async function journal(supabase: SupabaseClient, userId: string, today: LocalDate, days = 60) {
  const r = await supabase
    .from("recovery_entries")
    .select("*")
    .eq("user_id", userId)
    .gte("entry_date", addDays(today, -days))
    .order("entry_date", { ascending: false })
    .limit(days + 2);
  return (check("recovery_entries", r) as Record<string, unknown>[]).map(toEntry);
}

export type StrengthLog = {
  id: string;
  performedOn: LocalDate;
  title: string;
  minutes: number;
  exercises: (LoggedExercise & { reps?: number; seconds?: number })[];
};

export async function strengthLogs(supabase: SupabaseClient, userId: string, since: LocalDate): Promise<StrengthLog[]> {
  const r = await supabase
    .from("strength_logs")
    .select("id, performed_on, title, minutes, exercises")
    .eq("user_id", userId)
    .gte("performed_on", since)
    .order("performed_on", { ascending: false })
    .limit(100);
  return (check("strength_logs", r) as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    performedOn: x.performed_on as string,
    title: x.title as string,
    minutes: Number(x.minutes),
    exercises: x.exercises as StrengthLog["exercises"],
  }));
}

/** Daily training minutes (activities plus strength logs) for the last 28 days. */
export async function dailyLoads(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  today: LocalDate,
): Promise<DayLoad[]> {
  const since = addDays(today, -27);
  const [acts, strength] = await Promise.all([
    supabase
      .from("activities")
      .select("started_at, moving_seconds")
      .eq("user_id", userId)
      .eq("status", "ready")
      .gte("started_at", localMidnightUtc(since, timezone).toISOString())
      .limit(300),
    strengthLogs(supabase, userId, since),
  ]);
  const map = new Map<LocalDate, DayLoad>();
  const day = (d: LocalDate) => map.get(d) ?? map.set(d, { date: d, runMinutes: 0, strengthMinutes: 0 }).get(d)!;
  for (const a of check("activities", acts) as { started_at: string; moving_seconds: number }[])
    day(localDate(a.started_at, timezone)).runMinutes += Number(a.moving_seconds) / 60;
  for (const s of strength) day(s.performedOn).strengthMinutes += s.minutes;
  return [...map.values()];
}

/** Average fatigue over the last seven days, or null with no entries. Used by adaptive training and HYD Coach. */
export async function recentFatigue(supabase: SupabaseClient, userId: string, today: LocalDate) {
  const r = await supabase
    .from("recovery_entries")
    .select("fatigue")
    .eq("user_id", userId)
    .gte("entry_date", addDays(today, -6))
    .not("fatigue", "is", null);
  const v = (check("recovery_entries", r) as { fatigue: number }[]).map((x) => Number(x.fatigue));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
