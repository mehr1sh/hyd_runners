import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { RouteMap } from "@/components/map/route-map";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { ElevationProfile } from "@/features/routes/components/elevation-profile";
import {
  ConditionReportForm,
  ResolveReportButton,
  ReviewForm,
  RouteAttributesForm,
} from "@/features/routes/components/route-forms";
import {
  ageLabel,
  DIFFICULTY_LABEL,
  formatDistance,
  LIGHTING_LABEL,
  REPORT_KIND_LABEL,
  SHADE_LABEL,
  SURFACE_LABEL,
  TERRAIN_LABEL,
  yesNoUnknown,
} from "@/features/routes/logic";
import { getRoute } from "@/features/routes/queries";

export const metadata: Metadata = { title: "Route" };

export default async function RoutePage({ params }: PageProps<"/routes/[slug]">) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const ctx = await getRunnerContext();
  if (!ctx)
    return (
      <>
        <PageHeader title="Route" />
        <RunnerPreviewNotice feature="routes" />
      </>
    );
  const page = await getRoute(ctx.supabase, slug, ctx.user.id);
  if (!page) notFound();
  const { route, summary } = page;
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const canEdit = isManager || (route.createdBy === ctx.user.id && route.status === "draft");
  const facts: [string, string][] = [
    ["Distance", formatDistance(route.distanceM)],
    ["Shape", route.isLoop ? "Loop" : "Point to point"],
    ["Elevation gain", route.elevationGainM === null ? "Unknown" : `${Math.round(route.elevationGainM)} m`],
    ["Surface", SURFACE_LABEL[route.surface as keyof typeof SURFACE_LABEL]],
    ["Terrain", TERRAIN_LABEL[route.terrain as keyof typeof TERRAIN_LABEL]],
    ["Difficulty", DIFFICULTY_LABEL[route.difficulty as keyof typeof DIFFICULTY_LABEL]],
    ["Suits beginners", yesNoUnknown(route.beginnerSuitable)],
    ["Lighting", LIGHTING_LABEL[route.lighting as keyof typeof LIGHTING_LABEL]],
    ["Shade", SHADE_LABEL[route.shade as keyof typeof SHADE_LABEL]],
    ["Water refill", yesNoUnknown(route.waterRefill)],
    ["Public toilets", yesNoUnknown(route.toilets)],
    ["Parking", route.parking ?? "Unknown"],
    ["Meeting point", route.meetingPoint ?? "Unknown"],
  ];

  return (
    <>
      <PageHeader title={route.name} description={route.area ?? "Hyderabad"} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {route.geojson && (
            <RouteMap
              label={`Map of ${route.name}`}
              lines={[{ id: route.id, name: route.name, coordinates: route.geojson.coordinates }]}
            />
          )}
          {route.elevationProfile && <ElevationProfile profile={route.elevationProfile} />}
          {route.description && <p className="text-sm whitespace-pre-wrap">{route.description}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={v === "Unknown" ? "text-muted-foreground" : "font-medium text-brand-navy"}>{v}</dd>
              </div>
            ))}
          </dl>
          {route.trafficNotes && <p className="text-sm">Traffic: {route.trafficNotes}</p>}

          <section className="space-y-2" aria-labelledby="conditions">
            <h2 id="conditions" className="flex items-center gap-2 font-semibold text-brand-navy">
              <AlertTriangle className="size-4" aria-hidden /> Reported conditions
            </h2>
            {page.reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No current reports. That does not mean the route is safe or clear.
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Condition reports">
                {page.reports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border bg-card p-3 text-sm"
                  >
                    <span>
                      <Badge variant="outline">{REPORT_KIND_LABEL[r.kind]}</Badge> {r.note}
                      <span className="block text-xs text-muted-foreground">
                        Reported by a runner {ageLabel(r.createdAt, page.now)} · shown until{" "}
                        {formatDateTime(r.expiresAt, ctx.timezone)}
                      </span>
                    </span>
                    {isManager && <ResolveReportButton reportId={r.id} slug={route.slug} />}
                  </li>
                ))}
              </ul>
            )}
            {route.status === "published" && <ConditionReportForm routeId={route.id} slug={route.slug} />}
          </section>

          {route.status === "published" && (
            <section className="space-y-2" aria-labelledby="reviews">
              <h2 id="reviews" className="font-semibold text-brand-navy">
                Reviews
              </h2>
              {summary ? (
                <p className="text-sm">
                  {summary.rating?.toFixed(1)}★ overall from {summary.reviews} runner{summary.reviews === 1 ? "" : "s"}
                  {summary.safety !== null ? ` · feels safe ${summary.safety.toFixed(1)}` : ""}
                  {summary.shade !== null ? ` · shade ${summary.shade.toFixed(1)}` : ""}
                  {summary.surface !== null ? ` · surface ${summary.surface.toFixed(1)}` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No reviews yet.</p>
              )}
              <p className="text-xs text-muted-foreground">
                Ratings are runners&apos; opinions. A high rating does not mean a route is safe; check conditions before
                you go.
              </p>
              <ul className="space-y-2" aria-label="Review comments">
                {page.comments.map((c, i) => (
                  <li key={i} className="rounded-xl border bg-card p-3 text-sm">
                    {c.rating}★ · {c.comment}
                    <span className="block text-xs text-muted-foreground">{ageLabel(c.createdAt, page.now)}</span>
                  </li>
                ))}
              </ul>
              <ReviewForm routeId={route.id} slug={route.slug} mine={page.myReview} />
            </section>
          )}
        </div>
        <aside className="space-y-4">
          <section className="space-y-2 rounded-xl border bg-card p-4 text-sm" aria-label="Source">
            {route.verified ? (
              <Badge>
                <ShieldCheck className="size-3" aria-hidden /> Verified on the ground
                {route.verifiedAt ? ` · ${formatDateTime(route.verifiedAt, ctx.timezone)}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline">Not verified on the ground</Badge>
            )}
            <p>Source: {route.source === "osm" ? "traced from OpenStreetMap" : "GPX upload"}</p>
            <p className="text-xs text-muted-foreground">{route.sourceAttribution}</p>
            <p className="text-xs text-muted-foreground">Reference: {route.sourceRef}</p>
          </section>
          {page.events.length > 0 && (
            <section className="space-y-2 rounded-xl border bg-card p-4 text-sm" aria-labelledby="route-events">
              <h2 id="route-events" className="font-semibold text-brand-navy">
                Upcoming runs on this route
              </h2>
              <ul className="space-y-1">
                {page.events.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="underline underline-offset-4">
                      {e.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">· {formatDateTime(e.startsAt, ctx.timezone)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Link href="/routes" className="text-sm underline underline-offset-4">
            All routes
          </Link>
        </aside>
      </div>
      {canEdit && (
        <section className="mt-6 space-y-2" aria-labelledby="edit-route">
          <h2 id="edit-route" className="font-semibold text-brand-navy">
            Route details
          </h2>
          <RouteAttributesForm route={route} isManager={isManager} />
        </section>
      )}
    </>
  );
}
