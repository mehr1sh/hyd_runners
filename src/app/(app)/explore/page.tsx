import type { Metadata } from "next";
import { MapPin, Repeat, Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { HubCard } from "@/features/shared/hub-card";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage() {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Explore" description="Where to run in Hyderabad, and who to run with." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="explore" />
      </>
    );
  const [routes, series, places] = await Promise.all([
    ctx.supabase.from("routes").select("id", { count: "exact", head: true }).eq("status", "published"),
    ctx.supabase.from("group_run_series").select("id", { count: "exact", head: true }).eq("active", true),
    ctx.supabase.from("locations").select("id", { count: "exact", head: true }),
  ]);
  for (const [name, r] of [
    ["routes", routes],
    ["group_run_series", series],
    ["locations", places],
  ] as const) {
    if (r.error) throw new DatabaseQueryError(name, r.error);
  }
  const n = (c: number | null) => c ?? 0;
  return (
    <>
      {header}
      <ul className="grid gap-3 sm:grid-cols-3">
        <HubCard
          href="/routes"
          icon={RouteIcon}
          title="Routes"
          description="Mapped routes with reviews and current conditions."
          figure={`${n(routes.count)} published route${n(routes.count) === 1 ? "" : "s"}`}
        />
        <HubCard
          href="/runs"
          icon={Repeat}
          title="Group runs"
          description="Weekly runs with pace groups and a no-drop promise."
          figure={`${n(series.count)} weekly run${n(series.count) === 1 ? "" : "s"}`}
        />
        <HubCard
          href="/map"
          icon={MapPin}
          title="Places"
          description="Parks and grounds to run, on the map."
          figure={`${n(places.count)} place${n(places.count) === 1 ? "" : "s"}`}
        />
      </ul>
    </>
  );
}
