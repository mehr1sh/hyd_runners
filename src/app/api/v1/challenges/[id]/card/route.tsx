import { z } from "zod";
import { fail } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { CHALLENGE_KIND, displayValue, type ChallengeKind } from "@/features/challenges/logic";
import { challengeCard, renderCard } from "@/features/share/cards";
import { parseCardOptions, safeFilename } from "@/features/share/logic";

/**
 * GET /api/v1/challenges/:id/card?format=square|story|wide
 * A PNG card for a challenge the caller has completed. Shows no one else's data.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return fail("not_found", "Challenge not found.");
  try {
    const { supabase, user } = auth.caller;
    const [challenge, mine] = await Promise.all([
      supabase
        .from("challenges")
        .select("title, scope, kind, goal, collective, reward_xp")
        .eq("id", id.data)
        .maybeSingle(),
      supabase
        .from("challenge_participants")
        .select("completed_at")
        .eq("challenge_id", id.data)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (challenge.error) throw challenge.error;
    if (mine.error) throw mine.error;
    if (!challenge.data || !mine.data?.completed_at) return fail("not_found", "Completed challenge not found.");
    const c = challenge.data as {
      title: string;
      scope: "city" | "club";
      kind: ChallengeKind;
      goal: number;
      collective: boolean;
      reward_xp: number;
    };
    const options = parseCardOptions(new URL(request.url).searchParams);
    const goal = `${displayValue(c.kind, Number(c.goal))} ${CHALLENGE_KIND[c.kind].unit}${c.collective ? " together" : ""}`;
    return renderCard(
      challengeCard(
        {
          title: c.title,
          goalLabel: `${CHALLENGE_KIND[c.kind].label}: ${goal}`,
          completedAt: mine.data.completed_at as string,
          scopeLabel: c.scope === "city" ? "City challenge" : "Club challenge",
          rewardXp: c.reward_xp,
        },
        options,
      ),
      options,
      safeFilename(c.title),
    );
  } catch (error) {
    return internalError("challenge card", error, "Could not create the share card.");
  }
}
