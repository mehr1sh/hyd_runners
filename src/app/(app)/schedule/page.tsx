import type { Metadata } from "next";
import { Lock, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Schedule" };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SchedulePage() {
  return (
    <>
      <PageHeader
        title="Schedule"
        description="Your training week, planned around the times you are busy."
        actions={
          <Button disabled>
            <Upload aria-hidden /> Upload timetable
          </Button>
        }
      />
      <div className="space-y-6">
        <PlaceholderNotice feature="the schedule planner" owner="Planning" />

        <Tabs defaultValue="week">
          <TabsList>
            <TabsTrigger value="week">This week</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="upload">Timetable upload</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="pt-4">
            <ul className="grid gap-2 sm:grid-cols-7" aria-label="Days of this week">
              {DAYS.map((day) => (
                <li key={day} className="flex min-h-24 flex-col gap-2 rounded-xl border bg-card p-3">
                  <span className="text-sm font-semibold text-brand-navy">{day}</span>
                  <span className="text-xs text-muted-foreground">No sessions</span>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="availability" className="pt-4">
            <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              Your weekly busy and free times will appear here after you upload a timetable or add them by hand.
            </p>
          </TabsContent>

          <TabsContent value="upload" className="pt-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-input bg-card px-6 py-10 text-center">
              <Upload className="size-6 text-brand-navy" aria-hidden />
              <p className="font-medium text-brand-navy">PDF, PNG, JPG or WebP, up to 10 MB</p>
              <p className="flex max-w-md items-start gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                Timetables are stored privately. You will review everything we read before it is saved.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
