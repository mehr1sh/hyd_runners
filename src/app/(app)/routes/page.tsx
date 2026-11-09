import type { Metadata } from "next";
import Link from "next/link";
import { Route as RouteIcon, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteMap } from "@/components/map/route-map";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatDistance, SURFACE_LABEL } from "@/features/routes/logic";
import { searchPlaces, searchRoutes } from "@/features/routes/queries";
import {
  DIFFICULTIES,
  filterChips,
  filtersFromParams,
  isFiltered,
  LIGHTINGS,
  parseRouteQuery,
  searchHref,
  SHADES,
  SURFACES,
  TERRAINS,
  valueLabel,
  type SearchFilters,
} from "@/features/routes/search";

export const metadata: Metadata = { title: "Routes" };

const SORT_LABEL: Record<SearchFilters["sort"], string> = {
  relevance: "Best match",
  nearest: "Nearest start",
  distance_asc: "Shortest first",
  distance_desc: "Longest first",
  rating: "Highest rated",
  name: "Name",
};

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

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
  const asked = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const places = await searchPlaces(ctx.supabase);
  const parsed = asked ? parseRouteQuery(asked, places) : null;
  const filters = parsed?.filters ?? filtersFromParams(sp);
  const near = filters.placeId ? (places.find((p) => p.id === filters.placeId) ?? null) : null;
  const routes = await searchRoutes(ctx.supabase, filters, near);
  const chips = filterChips(filters, near?.name ?? null);
  const sortHref = (sort: SearchFilters["sort"]) => searchHref({ ...filters, sort });
  const sorts = (Object.keys(SORT_LABEL) as SearchFilters["sort"][]).filter((s) => s !== "nearest" || near);

  return (
    <>
      {header}
      <div className="space-y-6">
        <section aria-label="Search routes" className="space-y-3">
          <form method="get" action="/routes" role="search" className="flex gap-2">
            <Label htmlFor="route-q" className="sr-only">
              Describe the run you want
            </Label>
            <Input
              id="route-q"
              name="q"
              defaultValue={asked}
              maxLength={200}
              placeholder="e.g. flat 5k loop near KBR Park with lights"
              className="min-w-0 flex-1"
            />
            <Button type="submit">
              <Search className="size-4" aria-hidden /> Search
            </Button>
          </form>
          {parsed && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {parsed.understood.length
                ? `We searched for: ${parsed.understood.join(" · ")}.`
                : "We couldn’t pick out any filters, so all routes are shown."}{" "}
              <span>Search understands distances, places, terrain, surface, lighting, shade and facilities.</span>
            </p>
          )}
          {chips.length > 0 && (
            <ul aria-label="Active filters" className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <li key={c.key}>
                  <Link
                    href={searchHref(c.without)}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-navy bg-brand-navy px-3 py-1 text-sm text-white"
                    aria-label={`Remove filter: ${c.label}`}
                  >
                    {c.label} <X className="size-3" aria-hidden />
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/routes" className="inline-flex px-2 py-1 text-sm underline underline-offset-4">
                  Clear all
                </Link>
              </li>
            </ul>
          )}
          <FilterForm filters={filters} places={places} />
        </section>

        {routes.length === 0 ? (
          <EmptyState
            icon={RouteIcon}
            title="No routes match"
            description={
              isFiltered(filters)
                ? "Try removing a filter. Routes whose details are unknown are left out of filtered results."
                : "No routes have been published yet."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm" aria-live="polite">
                {routes.length === 100
                  ? "Showing the first 100 routes"
                  : `${routes.length} route${routes.length === 1 ? "" : "s"}`}
              </p>
              <nav aria-label="Sort routes" className="flex flex-wrap gap-1 text-sm">
                {sorts.map((s) => (
                  <Link
                    key={s}
                    href={sortHref(s)}
                    aria-current={filters.sort === s ? "true" : undefined}
                    className={
                      filters.sort === s
                        ? "rounded-md bg-muted px-2 py-1 font-medium"
                        : "rounded-md px-2 py-1 underline-offset-4 hover:underline"
                    }
                  >
                    {SORT_LABEL[s]}
                  </Link>
                ))}
              </nav>
            </div>
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
            <ul aria-label="Routes" className="grid gap-3 sm:grid-cols-2">
              {routes.map((r) => (
                <li key={r.id} className="space-y-2 rounded-xl border bg-card p-4">
                  <h2 className="font-semibold text-brand-navy">
                    <Link href={`/routes/${r.slug}`} className="underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{formatDistance(r.distanceM)}</Badge>
                    {r.isLoop && <Badge variant="outline">Loop</Badge>}
                    {r.terrain !== "unknown" && <Badge variant="outline">{valueLabel(r.terrain)}</Badge>}
                    {r.verified ? (
                      <Badge>
                        <ShieldCheck className="size-3" aria-hidden /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not verified</Badge>
                    )}
                    {r.openReports > 0 && (
                      <Badge variant="destructive">
                        <TriangleAlert className="size-3" aria-hidden /> {r.openReports} open report
                        {r.openReports === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {r.status !== "published" && <Badge variant="outline">{r.status}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.area ? `${r.area} · ` : ""}Surface: {SURFACE_LABEL[r.surface as keyof typeof SURFACE_LABEL]} ·{" "}
                    {r.reviews > 0 && r.rating !== null
                      ? `${r.rating.toFixed(1)}★ from ${r.reviews} review${r.reviews === 1 ? "" : "s"}`
                      : "No reviews yet"}
                  </p>
                  {r.distanceFromM !== null && near && (
                    <p className="text-sm">
                      Starts {formatDistance(r.distanceFromM)} from {near.name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Source: {r.source === "osm" ? "OpenStreetMap" : "GPX upload"}
                  </p>
                </li>
              ))}
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

function FilterForm({ filters: f, places }: { filters: SearchFilters; places: { id: string; name: string }[] }) {
  const groups = [
    ["surface", "Surface", SURFACES],
    ["terrain", "Terrain", TERRAINS],
    ["difficulty", "Difficulty", DIFFICULTIES],
    ["lighting", "Lighting", LIGHTINGS],
    ["shade", "Shade", SHADES],
  ] as const;
  const toggles = [
    ["loop", "Loops only", f.loop],
    ["beginner", "Suits beginners", f.beginner],
    ["verified", "Verified on the ground", f.verified],
    ["water", "Water refill", f.water],
    ["toilets", "Toilets", f.toilets],
    ["noreports", "No open condition reports", f.noReports],
  ] as const;
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Filters</summary>
      <form method="get" action="/routes" className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1">
            <Label htmlFor="f-text">Name or area</Label>
            <Input id="f-text" name="text" defaultValue={f.text ?? ""} maxLength={200} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-place">Near</Label>
            <select id="f-place" name="place" defaultValue={f.placeId ?? ""} className={selectClass}>
              <option value="">Anywhere</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-radius">Within (km of the place)</Label>
            <Input id="f-radius" name="radius" type="number" min={0.5} max={50} step="0.5" defaultValue={f.radiusKm} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="f-min">Min km</Label>
              <Input id="f-min" name="min" type="number" min={0} max={100} step="0.5" defaultValue={f.minKm ?? ""} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="f-max">Max km</Label>
              <Input id="f-max" name="max" type="number" min={0} max={100} step="0.5" defaultValue={f.maxKm ?? ""} />
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {groups.map(([name, legend, values]) => (
            <fieldset key={name} className="grid gap-1">
              <legend className="mb-1 text-sm font-medium">{legend}</legend>
              {values.map((v) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={name} value={v} defaultChecked={f[name].includes(v)} />
                  {valueLabel(v)}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-1 text-sm font-medium">Must have</legend>
          {toggles.map(([name, label, on]) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} value="1" defaultChecked={on} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="f-rating">Minimum rating</Label>
            <select id="f-rating" name="rating" defaultValue={f.minRating ?? ""} className={selectClass}>
              <option value="">Any</option>
              {[3, 3.5, 4, 4.5].map((r) => (
                <option key={r} value={r}>
                  {r}★ or more
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-sort">Sort by</Label>
            <select id="f-sort" name="sort" defaultValue={f.sort} className={selectClass}>
              {(Object.keys(SORT_LABEL) as SearchFilters["sort"][]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                  {s === "nearest" ? " (needs a place)" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Apply filters
          </Button>
        </div>
      </form>
    </details>
  );
}
