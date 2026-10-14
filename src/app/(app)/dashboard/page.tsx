import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Flame } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Today" };

export default async function DashboardPage() {
  const user = await getCurrentUser();

  return (
    <>
      <PageHeader
        title={user ? `Hello, ${user.displayName}` : "Today"}
        description="Your next session, this week's plan and your progress in one place."
      />
      <div className="space-y-6">
        <PlaceholderNotice feature="the runner dashboard" owner="Training" />

        <EmptyState
          icon={CalendarDays}
          title="No session planned yet"
          description="Set your goal and add your timetable, and your first week of sessions will appear here."
          action={
            <Button asChild>
              <Link href="/onboarding">Set up my plan</Link>
            </Button>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
              <CardDescription>Planned and completed sessions will be tracked here.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Nothing scheduled.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-4 text-brand-red" aria-hidden /> Streak and XP
              </CardTitle>
              <CardDescription>Your streak starts with your first logged session.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">No activity yet.</CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
