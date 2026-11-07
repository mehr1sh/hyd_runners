import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FitnessLevel } from "@/lib/contracts";
import { getAiProvider } from "@/lib/ai";
import { dateForWeekday, weekStartFor } from "../logic/time";
import type { PlannerInitialData } from "../components/schedule-planner";
import { callerTimezone, latestSettings, loadApprovedPlan, loadAvailability } from "./data";

/** Everything the schedule page needs on first render, read with the runner's own session. */
export async function loadPlannerPageData(supabase: SupabaseClient, userId: string): Promise<PlannerInitialData> {
  const timezone = await callerTimezone(supabase, userId);
  const thisWeek = weekStartFor(new Date(), timezone);
  const nextWeek = dateForWeekday(thisWeek, 8);
  const [availability, current, next, settings, profile] = await Promise.all([
    loadAvailability(supabase),
    loadApprovedPlan(supabase, thisWeek),
    loadApprovedPlan(supabase, nextWeek),
    latestSettings(supabase),
    supabase.from("profiles").select("fitness_level").eq("id", userId).maybeSingle(),
  ]);
  const level = FitnessLevel.safeParse(profile.data?.fitness_level);
  return {
    availability,
    weeks: [
      { weekStart: thisWeek, label: `This week (from ${thisWeek})` },
      { weekStart: nextWeek, label: `Next week (from ${nextWeek})` },
    ],
    plans: { [thisWeek]: current, [nextWeek]: next },
    latestSettings: settings,
    profileFitnessLevel: level.success ? level.data : null,
    aiConfigured: getAiProvider() !== null,
    timezone,
  };
}
