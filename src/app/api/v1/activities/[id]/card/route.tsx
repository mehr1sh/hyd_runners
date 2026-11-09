import { z } from "zod";
import { fail } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { toActivity } from "@/features/activities/queries";
import { activityCard, renderCard } from "@/features/share/cards";
import { parseCardOptions, safeFilename } from "@/features/share/logic";

const COLUMNS =
  "id, user_id, activity_type, name, visibility, privacy_trim_m, status, started_at, distance_m, moving_seconds, avg_pace_s, elevation_gain_m, best_efforts, created_at, activity_public_geojson";

/**
 * GET /api/v1/activities/:id/card?format=square|story|wide&route=0&pace=0
 * A PNG share card. Owner only; draws the privacy-trimmed route, never the full track.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return fail("not_found", "Activity not found.");
  try {
    const { data, error } = await auth.caller.supabase
      .from("activities")
      .select(COLUMNS)
      .eq("id", id.data)
      .eq("user_id", auth.caller.user.id)
      .eq("status", "ready")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail("not_found", "Activity not found.");
    const a = toActivity(data);
    const options = parseCardOptions(new URL(request.url).searchParams);
    return renderCard(
      activityCard(a, options),
      options,
      safeFilename(a.name ?? `activity-${a.startedAt?.slice(0, 10)}`),
    );
  } catch (error) {
    return internalError("activity card", error, "Could not create the share card.");
  }
}
