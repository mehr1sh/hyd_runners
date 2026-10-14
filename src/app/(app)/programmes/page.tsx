import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Programmes" };

/** Programme outlines (product content, not runner data). Final content comes from the database. */
const PROGRAMMES = [
  {
    title: "Couch to 5K",
    level: "Beginner",
    outline: "9 weeks · 3 sessions a week · 20–30 minutes",
    body: "Alternate walking and running, building gradually until you can run 5 km or 30 minutes without stopping.",
  },
  {
    title: "Strength and conditioning",
    level: "Intermediate",
    outline: "Programme length to be confirmed by coaches",
    body: "Bodyweight strength, mobility and conditioning to support running and reduce injury risk.",
  },
];

export default function ProgrammesPage() {
  return (
    <>
      <PageHeader title="Programmes" description="Structured plans that progress at a pace beginners can keep." />
      <div className="space-y-6">
        <PlaceholderNotice feature="training programmes" owner="Training">
          Programme outlines are draft content; enrolment is not available yet.
        </PlaceholderNotice>
        <div className="grid gap-4 md:grid-cols-2">
          {PROGRAMMES.map((p) => (
            <Card key={p.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{p.title}</CardTitle>
                  <Badge variant="secondary">{p.level}</Badge>
                </div>
                <CardDescription>{p.outline}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{p.body}</CardContent>
              <CardFooter>
                <Button variant="outline" disabled>
                  Enrolment coming soon
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
