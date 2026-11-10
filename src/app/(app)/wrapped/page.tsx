import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { duration, km, pace } from "@/features/activities/logic/format";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDuration } from "@/features/events/logic";
import { consistency, MONTHS } from "@/features/storytelling/logic";

export const metadata: Metadata = { title: "Running Wrapped" };

type Year = {
  activities: number;
  distanceM: number;
  movingSeconds: number;
  elevationGainM: number;
  longest: { id: string; distanceM: number; startedAt: string } | null;
  fastest5k: { id: string; seconds: number; startedAt: string } | null;
  mostActiveMonth: { month: number; distanceM: number; activities: number } | null;
  mostRepeatedRoute: { times: number; exampleActivityId: string } | null;
  groupRunsAttended: number;
  eventsAttended: number;
  clubs: number;
};

const BEST = { "5k": "5 km", "10k": "10 km", half: "Half marathon", marathon: "Marathon" } as const;

export default async function WrappedPage({ searchParams }: PageProps<"/wrapped">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Running Wrapped"
      description="Your year in running, from your own activities. Only what's recorded is shown."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="Running Wrapped" />
      </>
    );
  const sp = await searchParams;
  const thisYear = Number(ctx.today.slice(0, 4));
  const year =
    typeof sp.year === "string" && /^\d{4}$/.test(sp.year) && Number(sp.year) <= thisYear && Number(sp.year) >= 2015
      ? Number(sp.year)
      : thisYear;
  const [summary, acts, first] = await Promise.all([
    ctx.supabase.rpc("my_year_in_running", { p_year: year, p_timezone: ctx.timezone }),
    ctx.supabase
      .from("activities")
      .select("started_at, distance_m, moving_seconds, avg_pace_s, activity_type, best_efforts")
      .eq("user_id", ctx.user.id)
      .eq("status", "ready")
      .gte("started_at", `${year}-01-01T00:00:00+05:30`)
      .lt("started_at", `${year + 1}-01-01T00:00:00+05:30`)
      .order("started_at")
      .limit(2000),
    ctx.supabase
      .from("activities")
      .select("started_at")
      .eq("user_id", ctx.user.id)
      .eq("status", "ready")
      .order("started_at")
      .limit(1)
      .maybeSingle(),
  ]);
  const y = summary.data as Year | null;
  const rows = (acts.data ?? []) as {
    started_at: string;
    distance_m: number;
    moving_seconds: number;
    avg_pace_s: number | null;
    activity_type: string;
    best_efforts: Record<string, number>;
  }[];
  const cons = consistency(
    rows.map((r) => new Date(Date.parse(r.started_at) + 330 * 60_000).toISOString().slice(0, 10)),
  );
  const bests = Object.fromEntries(
    (Object.keys(BEST) as (keyof typeof BEST)[])
      .map((k) => [k, Math.min(...rows.map((r) => Number(r.best_efforts?.[k] ?? Infinity)))] as const)
      .filter(([, v]) => Number.isFinite(v)),
  );
  // Progress: average run pace in the first and last three months with at least five runs each.
  const runs = rows.filter(
    (r) => (r.activity_type === "run" || r.activity_type === "walk_run") && r.avg_pace_s && r.distance_m >= 2000,
  );
  const avg = (list: typeof runs) =>
    list.reduce((s, r) => s + Number(r.moving_seconds), 0) /
    (list.reduce((s, r) => s + Number(r.distance_m), 0) / 1000);
  const early = runs.slice(0, Math.min(runs.length, 15));
  const late = runs.slice(-Math.min(runs.length, 15));
  const progress = runs.length >= 10 && early[0] !== late[0] ? { early: avg(early), late: avg(late) } : null;
  const joined = first.data?.started_at ? String(first.data.started_at).slice(0, 10) : null;

  return (
    <>
      {header}
      <nav aria-label="Years" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[thisYear, thisYear - 1, thisYear - 2].map((yy) => (
          <Link
            key={yy}
            href={`/wrapped?year=${yy}`}
            aria-current={yy === year ? "page" : undefined}
            className="rounded-full border px-3 py-1 aria-[current=page]:bg-brand-navy aria-[current=page]:text-white"
          >
            {yy}
          </Link>
        ))}
      </nav>
      {!y || y.activities === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm">No activities recorded in {year}.</p>
      ) : (
        <div className="space-y-6">
          <section
            aria-label={`${year} in numbers`}
            className="grid gap-3 rounded-2xl bg-[#0b0f1a] p-6 text-white sm:grid-cols-4"
          >
            {[
              ["Distance", km(y.distanceM)],
              ["Moving time", duration(y.movingSeconds)],
              ["Activities", String(y.activities)],
              ["Elevation", `${Math.round(y.elevationGainM)} m`],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-sm opacity-70">{l}</p>
                <p className="text-3xl font-bold text-[#39ff88]">{v}</p>
              </div>
            ))}
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            {y.longest && (
              <Card title="Longest run">
                <Link href={`/activities/${y.longest.id}`} className="underline underline-offset-4">
                  {km(y.longest.distanceM)} on {y.longest.startedAt.slice(0, 10)}
                </Link>
              </Card>
            )}
            {y.fastest5k && (
              <Card title="Fastest 5 km (GPS)">
                <Link href={`/activities/${y.fastest5k.id}`} className="underline underline-offset-4">
                  {formatDuration(y.fastest5k.seconds)} on {y.fastest5k.startedAt.slice(0, 10)}
                </Link>
              </Card>
            )}
            {y.mostActiveMonth && (
              <Card title="Most active month">
                {MONTHS[y.mostActiveMonth.month - 1]}: {km(y.mostActiveMonth.distanceM)} over{" "}
                {y.mostActiveMonth.activities} activities
              </Card>
            )}
            {y.mostRepeatedRoute && (
              <Card title="Most repeated route">
                <Link
                  href={`/activities/${y.mostRepeatedRoute.exampleActivityId}`}
                  className="underline underline-offset-4"
                >
                  Run {y.mostRepeatedRoute.times} times
                </Link>
              </Card>
            )}
            <Card title="Consistency">
              {cons.activeWeeks} active weeks · longest streak {cons.longestWeekStreak} week
              {cons.longestWeekStreak === 1 ? "" : "s"}
            </Card>
            <Card title="Together">
              {y.groupRunsAttended} group run{y.groupRunsAttended === 1 ? "" : "s"} · {y.eventsAttended} event
              {y.eventsAttended === 1 ? "" : "s"} checked in · {y.clubs} club{y.clubs === 1 ? "" : "s"}
            </Card>
            {Object.keys(bests).length > 0 && (
              <Card title="Best efforts this year (GPS)">
                {Object.entries(bests)
                  .map(([k, v]) => `${BEST[k as keyof typeof BEST]} ${formatDuration(v)}`)
                  .join(" · ")}
              </Card>
            )}
            {progress && (
              <Card title="Progress through the year">
                Average run pace {pace(Math.round(progress.early))} in your first runs,{" "}
                {pace(Math.round(progress.late))} in your latest.
              </Card>
            )}
            {joined && <Card title="Since you started">First activity on HYD Runners: {joined}</Card>}
          </div>
          <section aria-labelledby="poster-h" className="space-y-2 text-sm">
            <h2 id="poster-h" className="font-semibold text-brand-navy">
              Monthly posters
            </h2>
            <p className="flex flex-wrap gap-2">
              {MONTHS.map((name, i) => {
                const mm = `${year}-${String(i + 1).padStart(2, "0")}`;
                return mm <= ctx.today.slice(0, 7) ? (
                  <a
                    key={mm}
                    href={`/api/v1/me/poster?month=${mm}&theme=neon`}
                    download={`hyd-runners-${mm}.png`}
                    className="rounded-full border px-3 py-1 hover:bg-muted"
                  >
                    {name.slice(0, 3)}
                  </a>
                ) : null;
              })}
            </p>
          </section>
        </div>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1 rounded-xl border bg-card p-4 text-sm">
      <h2 className="font-semibold text-brand-navy">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
