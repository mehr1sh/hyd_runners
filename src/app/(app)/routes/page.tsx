import type { Metadata } from "next";
import Link from "next/link";
import { Route as RouteIcon, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RouteMap } from "@/components/map/route-map";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDistance, parseRouteFilters, SURFACE_LABEL } from "@/features/routes/logic";
import { listRoutes, reviewSummaries } from "@/features/routes/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Routes" };

export default async function RoutesPage({ searchParams }: PageProps<"/routes">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Hyderabad Run Explorer"
      description="Real routes from GPX tracks and OpenStreetMap, with community reviews and condition reports."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="routes" />
      </>
    );
  const sp = await searchParams;
  const filters = parseRouteFilters(sp);
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const routes = await listRoutes(ctx.supabase, filters, { includeDrafts: isManager });
  const summaries = await reviewSummaries(
    ctx.supabase,
    routes.map((r) => r.id),
  );
  const toggle = (key: "beginner" | "loop" | "verified") => {
    const next = new URLSearchParams();
    for (const k of ["beginner", "loop", "verified"] as const)
      if (k === key ? !filters[k] : filters[k]) next.set(k, "1");
    if (filters.minKm) next.set("min", String(filters.minKm));
    if (filters.maxKm) next.set("max", String(filters.maxKm));
    const q = next.toString();
    return q ? `/routes?${q}` : "/routes";
  };

  return (
    <>
      {header}
      <div className="space-y-6">
        <nav aria-label="Route filters" className="flex flex-wrap items-end gap-2">
          {(
            [
              ["beginner", "Suits beginners"],
              ["loop", "Loops"],
              ["verified", "Verified on the ground"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={toggle(key)}
              aria-pressed={filters[key]}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                filters[key] ? "border-brand-navy bg-brand-navy text-white" : "",
              )}
            >
              {label}
            </Link>
          ))}
          <form method="get" action="/routes" className="flex items-end gap-2">
            {filters.beginner && <input type="hidden" name="beginner" value="1" />}
            {filters.loop && <input type="hidden" name="loop" value="1" />}
            {filters.verified && <input type="hidden" name="verified" value="1" />}
            <label className="grid gap-1 text-xs">
              Min km
              <input
                name="min"
                type="number"
                min={0}
                max={100}
                step="0.5"
                defaultValue={filters.minKm ?? ""}
                className="h-8 w-20 rounded-md border px-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs">
              Max km
              <input
                name="max"
                type="number"
                min={0}
                max={100}
                step="0.5"
                defaultValue={filters.maxKm ?? ""}
                className="h-8 w-20 rounded-md border px-2 text-sm"
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
          </form>
        </nav>
        {filters.beginner && (
          <p className="text-sm text-muted-foreground">
            Only routes someone has marked as suiting beginners are shown. Routes where this is unknown are hidden.
          </p>
        )}
        {routes.length === 0 ? (
          <EmptyState icon={RouteIcon} title="No routes match" description="Try fewer filters." />
        ) : (
          <>
            <RouteMap
              label="Map of routes"
              lines={routes
                .filter((r) => r.geojson)
                .map((r) => ({
                  id: r.id,
                  name: r.name,
                  href: `/routes/${r.slug}`,
                  coordinates: r.geojson!.coordinates,
                }))}
            />
            <ul className="grid gap-3 sm:grid-cols-2">
              {routes.map((r) => {
                const s = summaries.get(r.id);
                return (
                  <li key={r.id} className="space-y-2 rounded-xl border bg-card p-4">
                    <h2 className="font-semibold text-brand-navy">
                      <Link href={`/routes/${r.slug}`} className="underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{formatDistance(r.distanceM)}</Badge>
                      {r.isLoop && <Badge variant="outline">Loop</Badge>}
                      {r.verified ? (
                        <Badge>
                          <ShieldCheck className="size-3" aria-hidden /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline">Not verified</Badge>
                      )}
                      {r.status !== "published" && <Badge variant="outline">{r.status}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {r.area ? `${r.area} · ` : ""}Surface: {SURFACE_LABEL[r.surface as keyof typeof SURFACE_LABEL]} ·{" "}
                      {s
                        ? `${s.rating?.toFixed(1)}★ from ${s.reviews} review${s.reviews === 1 ? "" : "s"}`
                        : "No reviews yet"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Source: {r.source === "osm" ? "OpenStreetMap" : "GPX upload"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="text-sm">
          <Link href="/routes/new" className="underline underline-offset-4">
            Contribute a GPX route
          </Link>{" "}
          <span className="text-muted-foreground">(programme managers and club admins)</span>
        </p>
      </div>
    </>
  );
}
