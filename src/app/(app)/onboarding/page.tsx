import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";

export const metadata: Metadata = { title: "Set up your plan" };

const STEPS = [
  { title: "Your goal", body: "Build a habit, finish your first 5K, run without stopping or get stronger." },
  { title: "Where you are now", body: "New to running, returning after a break, or already running a little." },
  { title: "Your timetable", body: "Upload a PDF or photo of your timetable, or mark busy times by hand." },
  { title: "Your preferences", body: "Preferred days, time of day and how long a session can be." },
];

export default function OnboardingPage() {
  return (
    <>
      <PageHeader title="Set up your plan" description="Four short steps. You can change any answer later." />
      <div className="space-y-6">
        <PlaceholderNotice feature="onboarding" owner="Planning" />
        <ol className="grid gap-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-xl border bg-card p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-navy text-sm font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold text-brand-navy">{step.title}</h2>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
