import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressMeter } from "@/components/shared/progress-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { listProgrammes, type ProgrammeCategory, type ProgrammeListItem } from "@/features/workouts/programme-queries";

export const metadata: Metadata = { title: "Programmes" };

const SECTIONS: { category: ProgrammeCategory; title: string; description: string }[] = [
  { category: "couch_to_5k", title: "Couch to 5K", description: "From walking to running 5 km in nine weeks." },
  {
    category: "running",
    title: "Running plans",
    description: "From your first jogs to a half marathon: 5K, 10K, endurance and half-marathon plans.",
  },
  {
    category: "general_fitness",
    title: "General fitness",
    description: "Yoga, upper body, mobility, strength and recovery.",
  },
  {
    category: "training_and_shine",
    title: "Training and Shine",
    description: "Coach-led, longer-term training for people who are already active.",
  },
];

const LEVEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;

function StatusBadge({ item }: { item: ProgrammeListItem }) {
  const s = item.enrollment?.status;
  if (!s || s === "withdrawn") return null;
  const label = { requested: "Requested", active: "Enrolled", paused: "Paused", completed: "Completed" }[s];
  return <Badge variant={s === "active" ? "default" : "secondary"}>{label}</Badge>;
}

export default async function ProgrammesPage() {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Programmes" description="Structured plans that progress at a pace you can keep." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="training programmes" />
      </>
    );
  const items = await listProgrammes(ctx);

  return (
    <>
      {header}
      <div className="space-y-10">
        {SECTIONS.map((section) => {
          const list = items.filter((i) => i.programme.category === section.category);
          if (!list.length) return null;
          return (
            <section key={section.category} aria-labelledby={`h-${section.category}`} className="space-y-4">
              <div>
                <h2 id={`h-${section.category}`} className="text-lg font-semibold text-brand-navy">
                  {section.title}
                </h2>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {list.map((item) => (
                  <Card key={item.programme.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle>{item.programme.title}</CardTitle>
                        <StatusBadge item={item} />
                      </div>
                      <CardDescription>
                        {LEVEL[item.programme.level]} · {item.programme.durationWeeks} weeks ·{" "}
                        {item.programme.sessionsPerWeek} sessions a week
                        {item.programme.enrolment === "coach_approval" && " · coach approval"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                      <p>{item.programme.summary}</p>
                      {item.progress && item.enrollment?.status !== "withdrawn" && (
                        <ProgressMeter
                          label="Sessions completed"
                          value={item.progress.completed}
                          max={item.progress.total}
                        />
                      )}
                    </CardContent>
                    <CardFooter>
                      <Button asChild variant={item.enrollment?.status === "active" ? "default" : "outline"}>
                        <Link href={`/programmes/${item.programme.slug}`}>
                          {item.enrollment?.status === "active" ? "Continue" : "View programme"}
                        </Link>
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
