import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LogWorkoutDialog } from "@/features/workouts/components/log-workout-dialog";

export const metadata: Metadata = { title: "Workouts" };

export default function WorkoutsPage() {
  return (
    <>
      <PageHeader
        title="Workout history"
        description="Every session you log, with time, distance and how it felt."
        actions={<LogWorkoutDialog />}
      />
      <div className="space-y-6">
        <PlaceholderNotice feature="workout logging" owner="Training" />
        <div className="rounded-xl border bg-card">
          <Table>
            <TableCaption className="sr-only">Logged workouts, newest first</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Workout</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Distance</TableHead>
                <TableHead className="hidden md:table-cell">Effort</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No workouts logged yet.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
