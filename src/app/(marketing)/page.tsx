import Link from "next/link";
import { ArrowRight, CalendarDays, Footprints, Upload, Users } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";

const EXAMPLE_WEEK = [
  { day: "Mon", busy: "Classes 9:00–17:00", run: "Walk-run · 25 min · 6:30" },
  { day: "Tue", busy: "Lab 14:00–18:00", run: null },
  { day: "Wed", busy: "Classes 9:00–13:00", run: "Walk-run · 25 min · 17:30" },
  { day: "Thu", busy: "Classes 10:00–16:00", run: null },
  { day: "Sat", busy: "Free", run: "Group run · KBR Park · 6:00" },
];

const NEEDS = [
  {
    title: "“I start, then stop.”",
    body: "Short sessions, a gentle progression and visible streaks make the next run easier than skipping it.",
  },
  {
    title: "“My timetable keeps changing.”",
    body: "Upload your class or work timetable and your sessions are placed in the gaps you actually have.",
  },
];

const STEPS = [
  {
    icon: Footprints,
    title: "Tell us where you are",
    body: "Never run before, coming back after a break, or already running a little.",
  },
  {
    icon: Upload,
    title: "Add your timetable",
    body: "Upload a PDF or photo, check what we read, or fill in your week by hand.",
  },
  {
    icon: CalendarDays,
    title: "Follow your week",
    body: "Log each session, keep your streak and adjust when plans change.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-card">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-6">
            <p className="text-sm font-semibold text-brand-red-strong">For beginners in Hyderabad</p>
            <h1 className="text-4xl font-semibold tracking-tight text-brand-navy sm:text-5xl">
              Build a running habit that fits your week.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              HYD Runners plans short, achievable sessions around your classes and commitments, then helps you keep
              going with coaches, mentors and people to run with.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Start your plan <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">I already have an account</Link>
              </Button>
            </div>
          </div>

          <figure className="rounded-2xl border bg-background p-5 sm:p-6">
            <figcaption className="mb-4 flex items-center justify-between text-sm">
              <span className="font-semibold text-brand-navy">An example week</span>
              <span className="text-muted-foreground">Illustration only</span>
            </figcaption>
            <ul className="divide-y rounded-xl border bg-card">
              {EXAMPLE_WEEK.map((d) => (
                <li key={d.day} className="grid grid-cols-[3rem_1fr] gap-3 px-4 py-3 text-sm">
                  <span className="font-semibold text-brand-navy">{d.day}</span>
                  <span className="space-y-1">
                    <span className="block text-muted-foreground">{d.busy}</span>
                    {d.run && (
                      <span className="flex items-center gap-2 font-medium text-brand-navy">
                        <span aria-hidden className="size-2 rounded-full bg-brand-red" />
                        {d.run}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </section>

        <section aria-labelledby="needs-heading" className="border-y bg-background">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="needs-heading" className="text-2xl font-semibold text-brand-navy">
              Made for the two reasons beginners stop
            </h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {NEEDS.map((n) => (
                <div key={n.title} className="space-y-2">
                  <h3 className="text-lg font-semibold text-brand-navy">{n.title}</h3>
                  <p className="text-muted-foreground">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-heading" className="text-2xl font-semibold text-brand-navy">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="space-y-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-brand-navy-soft">
                  <s.icon className="size-5 text-brand-navy" aria-hidden />
                </span>
                <h3 className="font-semibold text-brand-navy">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="together-heading" className="border-t bg-background">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl space-y-2">
              <h2 id="together-heading" className="flex items-center gap-2 text-2xl font-semibold text-brand-navy">
                <Users className="size-6" aria-hidden /> You will not run alone
              </h2>
              <p className="text-muted-foreground">
                Start with Couch to 5K, move on to strength and conditioning, and join community runs at parks and
                tracks across the city.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/sign-up">Start your plan</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
