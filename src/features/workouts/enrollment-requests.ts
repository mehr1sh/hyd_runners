import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/contracts";

/**
 * Requests for places on coach-led programmes. RLS decides who can see and
 * decide them: programme managers and admins see every request; coaches see
 * the runners assigned to them. Nobody can decide their own request.
 */

export const REVIEWER_ROLES: readonly Role[] = ["coach", "programme_manager", "admin"];
export const MAX_LISTED_REQUESTS = 100;

export type EnrollmentRequest = {
  id: string;
  runnerName: string;
  programmeTitle: string;
  programmeSlug: string | null;
  requestedAt: string;
};

export type ReviewDecision = "approve" | "decline";
export type ReviewResult = { ok: true } | { ok: false; message: string };

export function canReviewEnrollments(roles: readonly Role[]) {
  return roles.some((role) => REVIEWER_ROLES.includes(role));
}

/** Waiting requests the viewer may decide, oldest first. */
export async function listEnrollmentRequests(supabase: SupabaseClient, viewerId: string): Promise<EnrollmentRequest[]> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, created_at, runner:profiles!enrollments_user_id_fkey(display_name), programme:programmes(title, slug)")
    .eq("status", "requested")
    // The viewer's own request is readable to them, but never theirs to decide.
    .neq("user_id", viewerId)
    .order("created_at", { ascending: true })
    .limit(MAX_LISTED_REQUESTS);
  if (error) throw new Error(`Could not load enrolment requests: ${error.message}`);
  return (data ?? []).map((row) => {
    const runner = row.runner as unknown as { display_name: string } | null;
    const programme = row.programme as unknown as { title: string; slug: string } | null;
    return {
      id: row.id as string,
      runnerName: runner?.display_name ?? "A runner",
      programmeTitle: programme?.title ?? "A programme",
      programmeSlug: programme?.slug ?? null,
      requestedAt: row.created_at as string,
    };
  });
}

/**
 * Approve or decline a waiting request. The database trigger and RLS do the
 * authorisation; zero updated rows means the request was already decided or
 * is not one the caller may review.
 */
export async function reviewEnrollment(
  supabase: SupabaseClient,
  enrollmentId: string,
  decision: ReviewDecision,
): Promise<ReviewResult> {
  const { data, error } = await supabase
    .from("enrollments")
    .update({ status: decision === "approve" ? "active" : "withdrawn" })
    .eq("id", enrollmentId)
    .eq("status", "requested")
    .select("id");
  if (error) {
    if (error.code === "42501") return { ok: false, message: "You cannot review this request." };
    console.error(`[enrolments] Could not review ${enrollmentId} (${error.code}): ${error.message}`);
    return { ok: false, message: "Could not update the request. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "This request has already been handled." };
  return { ok: true };
}
