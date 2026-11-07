import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SchedulePlanner } from "@/features/scheduler/components/schedule-planner";
import { loadPlannerPageData } from "@/features/scheduler/server/page-data";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const header = (
    <PageHeader
      title="Schedule"
      description="Tell us when you are free, then get a training week that fits around it."
    />
  );

  const user = isSupabaseConfigured ? await getCurrentUser() : null;
  if (!user) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarClock}
          title="Sign in to plan your week"
          description="The schedule planner saves your timetable and plan to your account, so it needs sign-in. In preview mode (no Supabase configured) it is unavailable."
        />
      </>
    );
  }

  const initial = await loadPlannerPageData(await createClient(), user.id);
  return (
    <>
      {header}
      <SchedulePlanner initial={initial} />
    </>
  );
}
