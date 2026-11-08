import { z } from "zod";

export const SURFACE_LABEL = {
  road: "Road",
  track: "Running track",
  trail: "Trail",
  mixed: "Mixed",
  unknown: "Unknown",
} as const;
export const TERRAIN_LABEL = { flat: "Flat", rolling: "Rolling", hilly: "Hilly", unknown: "Unknown" } as const;
export const DIFFICULTY_LABEL = { easy: "Easy", moderate: "Moderate", hard: "Hard", unknown: "Unknown" } as const;
export const LIGHTING_LABEL = { lit: "Lit", partly_lit: "Partly lit", unlit: "Not lit", unknown: "Unknown" } as const;
export const SHADE_LABEL = {
  good: "Good shade",
  some: "Some shade",
  little: "Little shade",
  unknown: "Unknown",
} as const;
export const REPORT_KIND_LABEL = {
  hazard: "Hazard",
  closure: "Closure",
  construction: "Construction",
  lighting: "Lighting problem",
  traffic: "Heavy traffic",
  water: "Water point out of order",
  other: "Other",
} as const;
export type ReportKind = keyof typeof REPORT_KIND_LABEL;

export function yesNoUnknown(value: boolean | null) {
  return value === null ? "Unknown" : value ? "Yes" : "No";
}

export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10_000 ? 1 : 2)} km` : `${Math.round(meters)} m`;
}

/** "today", "yesterday", "5 days ago". Reports always show their age. */
export function ageLabel(iso: string, nowMs: number) {
  const days = Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export type GpxPoint = { lat: number; lon: number; ele: number | null };

const MAX_POINTS = 20_000;

/**
 * Track points from a GPX file (trkpt, falling back to rtept). A deliberately
 * small parser: attributes in either order, optional <ele>. Throws a
 * user-facing Error for anything that is not a usable single track.
 */
export function parseGpx(xml: string): GpxPoint[] {
  if (!/<gpx[\s>]/i.test(xml)) throw new Error("That file is not a GPX file.");
  const tag = /<trkpt\b/i.test(xml) ? "trkpt" : "rtept";
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, "gi");
  const points: GpxPoint[] = [];
  for (const m of xml.matchAll(re)) {
    const attrs = m[1];
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error("The GPX file has a point without valid coordinates.");
    }
    const eleRaw = m[2] ? /<ele>\s*([-\d.]+)\s*<\/ele>/i.exec(m[2])?.[1] : undefined;
    const ele = eleRaw === undefined ? null : Number(eleRaw);
    points.push({ lat, lon, ele: ele !== null && Number.isFinite(ele) ? ele : null });
    if (points.length > MAX_POINTS)
      throw new Error(`The track has more than ${MAX_POINTS} points. Simplify it and try again.`);
  }
  if (points.length < 2) throw new Error("The GPX file needs a track with at least two points.");
  return points;
}

function haversine(a: GpxPoint, b: GpxPoint) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Elevation gain/loss with a 3 m hysteresis (ignores GPS jitter) and a
 * profile of at most 200 [distance_m, elevation_m] pairs. Null when fewer than
 * 90% of points carry an elevation: we never invent one.
 */
export function elevationStats(points: GpxPoint[]) {
  const withEle = points.filter((p) => p.ele !== null).length;
  if (withEle < points.length * 0.9) return null;
  let gain = 0;
  let loss = 0;
  let anchor: number | null = null;
  let distance = 0;
  const profile: [number, number][] = [];
  const every = Math.max(1, Math.ceil(points.length / 200));
  points.forEach((p, i) => {
    if (i > 0) distance += haversine(points[i - 1], p);
    if (p.ele === null) return;
    if (anchor === null) anchor = p.ele;
    else if (p.ele - anchor >= 3) {
      gain += p.ele - anchor;
      anchor = p.ele;
    } else if (anchor - p.ele >= 3) {
      loss += anchor - p.ele;
      anchor = p.ele;
    }
    if (i % every === 0 || i === points.length - 1) profile.push([Math.round(distance), Math.round(p.ele * 10) / 10]);
  });
  return { gain: Math.round(gain * 10) / 10, loss: Math.round(loss * 10) / 10, profile };
}

export function toWkt(points: GpxPoint[]) {
  return `SRID=4326;LINESTRING(${points.map((p) => `${p.lon.toFixed(7)} ${p.lat.toFixed(7)}`).join(", ")})`;
}

const tri = (labels: Record<string, string>) => z.enum(Object.keys(labels) as [string, ...string[]]);
const yesNo = z.enum(["yes", "no", "unknown"]).transform((v) => (v === "unknown" ? null : v === "yes"));

export const RouteAttributes = z.object({
  surface: tri(SURFACE_LABEL),
  terrain: tri(TERRAIN_LABEL),
  difficulty: tri(DIFFICULTY_LABEL),
  lighting: tri(LIGHTING_LABEL),
  shade: tri(SHADE_LABEL),
  beginnerSuitable: yesNo,
  waterRefill: yesNo,
  toilets: yesNo,
  parking: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v)),
  meetingPoint: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v)),
  trafficNotes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

export function parseAttributes(formData: FormData) {
  const parsed = RouteAttributes.safeParse({
    surface: formData.get("surface") ?? "unknown",
    terrain: formData.get("terrain") ?? "unknown",
    difficulty: formData.get("difficulty") ?? "unknown",
    lighting: formData.get("lighting") ?? "unknown",
    shade: formData.get("shade") ?? "unknown",
    beginnerSuitable: formData.get("beginnerSuitable") ?? "unknown",
    waterRefill: formData.get("waterRefill") ?? "unknown",
    toilets: formData.get("toilets") ?? "unknown",
    parking: formData.get("parking") ?? "",
    meetingPoint: formData.get("meetingPoint") ?? "",
    trafficNotes: formData.get("trafficNotes") ?? "",
  });
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the form." };
  return { ok: true as const, data: parsed.data };
}

export function parseRouteFilters(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const km = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  };
  return {
    beginner: one("beginner") === "1",
    loop: one("loop") === "1",
    verified: one("verified") === "1",
    minKm: km(one("min")),
    maxKm: km(one("max")),
  };
}
export type RouteFilters = ReturnType<typeof parseRouteFilters>;
