import type { Metadata } from "next";
import { WeeklyMinutesChart } from "@/components/charts/weekly-minutes-chart";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice, SampleBadge } from "@/components/shared/placeholder-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Reports" };

/** Clearly labelled sample values used only to preview the chart layout. */
const SAMPLE_WEEK = [
  { label: "Mon", minutes: 20 },
  { label: "Tue", minutes: 0 },
  { label: "Wed", minutes: 25 },
  { label: "Thu", minutes: 0 },
  { label: "Fri", minutes: 0 },
  { label: "Sat", minutes: 30 },
  { label: "Sun", minutes: 0 },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Weekly, monthly and yearly summaries of your training." />
      <div className="space-y-6">
        <PlaceholderNotice feature="reports" owner="Training">
          The chart below uses sample numbers to preview the layout. It is not your activity.
        </PlaceholderNotice>
        <Tabs defaultValue="week">
          <TabsList>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
          <TabsContent value="week" className="pt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Active minutes by day</CardTitle>
                  <SampleBadge />
                </div>
                <CardDescription>
                  Logged workouts only. Rest days count towards your plan, not your minutes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WeeklyMinutesChart data={SAMPLE_WEEK} title="Sample active minutes by day" />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="month" className="pt-4">
            <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Monthly report coming soon.</p>
          </TabsContent>
          <TabsContent value="year" className="pt-4">
            <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Yearly report coming soon.</p>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
