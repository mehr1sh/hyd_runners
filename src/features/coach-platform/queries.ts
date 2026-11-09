import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";

function check<T>(name: string, r: { data: T; error: { code?: string; message: string } | null }) {
  if (r.error) throw new DatabaseQueryError(name, r.error);
  return r.data;
}

export type CoachRunner = {
  runnerId: string;
  displayName: string;
  sharesTraining: boolean;
  programme: string | null;
  lastActivityAt: string | null;
  distance7dM: number | null;
  planned28d: number | null;
  completed28d: number | null;
  openProposals: number;
  recentReplies: number;
  raceGoal: string | null;
};

export async function coachRunnerList(supabase: SupabaseClient): Promise<CoachRunner[]> {
  const rows = check("coach_runner_list", await supabase.rpc("coach_runner_list")) as Record<string, unknown>[];
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    runnerId: r.runner_id as string,
    displayName: r.display_name as string,
    sharesTraining: Boolean(r.shares_training),
    programme: (r.programme as string | null) ?? null,
    lastActivityAt: (r.last_activity_at as string | null) ?? null,
    distance7dM: n(r.distance_7d_m),
    planned28d: n(r.planned_28d),
    completed28d: n(r.completed_28d),
    openProposals: Number(r.open_proposals),
    recentReplies: Number(r.unread_replies),
    raceGoal: (r.race_goal as string | null) ?? null,
  }));
}

export type RunnerOverview = {
  displayName: string;
  sharesTraining: boolean;
  timezone?: string;
  fitnessLevel?: string | null;
  weeks?: { weekStart: string; distanceM: number; runs: number; movingS: number }[];
  activities?: {
    id: string;
    startedAt: string;
    type: string;
    distanceM: number;
    movingS: number;
    paceS: number | null;
    elevationM: number | null;
  }[];
  bestEfforts?: Record<string, number>;
  sessions?: {
    id: string;
    title: string;
    type: string;
    startsAt: string;
    minutes: number;
    status: string;
    plannedBy: string;
  }[];
  raceGoal?: { distance: string; raceDate: string; targetSeconds: number | null; name: string | null } | null;
  strength?: { date: string; title: string; minutes: number }[];
};

/** Null when the caller is not this runner's current coach. */
export async function coachRunnerOverview(supabase: SupabaseClient, runnerId: string): Promise<RunnerOverview | null> {
  const { data, error } = await supabase.rpc("coach_runner_overview", { p_runner: runnerId });
  if (error) {
    if (error.code === "42501") return null;
    throw new DatabaseQueryError("coach_runner_overview", error);
  }
  return data as RunnerOverview;
}

export type CoachNote = {
  id: string;
  coachId: string;
  coachName: string | null;
  kind: "workout_feedback" | "progress_note" | "recommendation";
  body: string;
  activityId: string | null;
  createdAt: string;
  replies: { id: string; authorId: string; body: string; createdAt: string }[];
};

/** Notes about a runner, visible to the runner and their current coach (RLS). */
export async function notesFor(supabase: SupabaseClient, runnerId: string): Promise<CoachNote[]> {
  const notes = check(
    "coach_notes",
    await supabase
      .from("coach_notes")
      .select(
        "id, coach_id, kind, body, activity_id, created_at, coach:profiles!coach_notes_coach_id_fkey(display_name)",
      )
      .eq("runner_id", runnerId)
      .order("created_at", { ascending: false })
      .limit(30),
  ) as Record<string, unknown>[];
  const ids = notes.map((n) => n.id as string);
  const replies = ids.length
    ? (check(
        "coach_note_replies",
        await supabase
          .from("coach_note_replies")
          .select("id, note_id, author_id, body, created_at")
          .in("note_id", ids)
          .order("created_at"),
      ) as Record<string, unknown>[])
    : [];
  return notes.map((n) => ({
    id: n.id as string,
    coachId: n.coach_id as string,
    coachName: ((n.coach as { display_name?: string } | null)?.display_name as string | undefined) ?? null,
    kind: n.kind as CoachNote["kind"],
    body: n.body as string,
    activityId: (n.activity_id as string | null) ?? null,
    createdAt: n.created_at as string,
    replies: replies
      .filter((r) => r.note_id === n.id)
      .map((r) => ({
        id: r.id as string,
        authorId: r.author_id as string,
        body: r.body as string,
        createdAt: r.created_at as string,
      })),
  }));
}

export async function sharedRecoveryFor(supabase: SupabaseClient, runnerId: string) {
  return check(
    "recovery_entries",
    await supabase
      .from("recovery_entries")
      .select("entry_date, sleep_quality, fatigue, soreness, energy, stress, notes")
      .eq("user_id", runnerId)
      .order("entry_date", { ascending: false })
      .limit(14),
  ) as {
    entry_date: string;
    sleep_quality: number | null;
    fatigue: number | null;
    soreness: number | null;
    energy: number | null;
    stress: number | null;
    notes: string | null;
  }[];
}

export async function coachProposalsFor(supabase: SupabaseClient, runnerId: string) {
  return check(
    "training_proposals",
    await supabase
      .from("training_proposals")
      .select("id, kind, title, status, created_at, decided_at, applied_changes, changes")
      .eq("user_id", runnerId)
      .order("created_at", { ascending: false })
      .limit(15),
  ) as {
    id: string;
    kind: string;
    title: string;
    status: string;
    created_at: string;
    decided_at: string | null;
    applied_changes: number[] | null;
    changes: unknown[];
  }[];
}

export type ProfessionalProfile = {
  userId: string;
  displayName?: string;
  profession: string;
  headline: string | null;
  bio: string | null;
  experienceYears: number | null;
  specializations: string[];
  credentials: { name: string; issuer?: string; year?: number; reference?: string }[];
  verificationStatus: "unverified" | "pending" | "verified" | "rejected" | "suspended";
  verificationNote: string | null;
  verifiedAt: string | null;
  listed: boolean;
};

export function toProfessional(r: Record<string, unknown>): ProfessionalProfile {
  return {
    userId: r.user_id as string,
    displayName: ((r.person as { display_name?: string } | null)?.display_name as string | undefined) ?? undefined,
    profession: r.profession as string,
    headline: (r.headline as string | null) ?? null,
    bio: (r.bio as string | null) ?? null,
    experienceYears: r.experience_years === null ? null : Number(r.experience_years),
    specializations: (r.specializations as string[]) ?? [],
    credentials: (r.credentials as ProfessionalProfile["credentials"]) ?? [],
    verificationStatus: r.verification_status as ProfessionalProfile["verificationStatus"],
    verificationNote: (r.verification_note as string | null) ?? null,
    verifiedAt: (r.verified_at as string | null) ?? null,
    listed: Boolean(r.listed),
  };
}

export const PROFESSIONAL_COLUMNS =
  "user_id, profession, headline, bio, experience_years, specializations, credentials, verification_status, verification_note, verified_at, listed, person:profiles!professional_profiles_user_id_fkey(display_name)";

export async function myProfessionalProfile(supabase: SupabaseClient, userId: string) {
  const r = await supabase
    .from("professional_profiles")
    .select(PROFESSIONAL_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  const row = check("professional_profiles", r) as Record<string, unknown> | null;
  return row ? toProfessional(row) : null;
}

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function myNotifications(supabase: SupabaseClient, userId: string): Promise<Notification[]> {
  const rows = check(
    "notifications",
    await supabase
      .from("notifications")
      .select("id, kind, title, body, href, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    href: (r.href as string | null) ?? null,
    readAt: (r.read_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

export async function unreadNotificationCount(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}
