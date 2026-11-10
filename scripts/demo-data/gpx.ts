/**
 * Sample GPX tracks for the demo seed. A track follows a real route's
 * geometry (from OpenStreetMap, already in the database) out and back, at
 * paces that vary a little from kilometre to kilometre. Tracks carry no
 * elevation or heart rate: those would be invented numbers.
 */

export type LonLat = [number, number];

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LonLat, b: LonLat) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A polyline with cumulative distances, for positions along it. */
export function measure(path: LonLat[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
  return { path, cum, length: cum[cum.length - 1] };
}

/**
 * Position `s` metres along a route run out and back (or round and round
 * when `loop`), repeating as needed.
 */
export function positionAt(m: ReturnType<typeof measure>, s: number, loop: boolean): LonLat {
  const L = m.length;
  let d = loop ? s % L : s % (2 * L);
  if (!loop && d > L) d = 2 * L - d;
  let i = 1;
  while (i < m.cum.length - 1 && m.cum[i] < d) i++;
  const seg = m.cum[i] - m.cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (d - m.cum[i - 1]) / seg));
  const [a, b] = [m.path[i - 1], m.path[i]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Pace (s/km) for each metre band of a run. */
export type PacePlan = { untilM: number; pace: number }[];

export function trackPoints(opts: {
  route: ReturnType<typeof measure>;
  loop: boolean;
  start: Date;
  distanceM: number;
  plan: PacePlan;
  seed: number;
  stepS?: number;
}) {
  const step = opts.stepS ?? 5;
  const rand = rng(opts.seed);
  // Small kilometre-to-kilometre variation, as on any real run.
  const wobble = Array.from({ length: Math.ceil(opts.distanceM / 1000) + 1 }, () => 1 + (rand() - 0.5) * 0.06);
  const paceAt = (s: number) => {
    const band = opts.plan.find((b) => s < b.untilM) ?? opts.plan[opts.plan.length - 1];
    return band.pace * wobble[Math.floor(s / 1000)];
  };
  const points: { t: Date; lon: number; lat: number }[] = [];
  let s = 0;
  let t = 0;
  while (s < opts.distanceM) {
    const [lon, lat] = positionAt(opts.route, s, opts.loop);
    // GPS noise of a metre or two.
    const jitter = () => (rand() - 0.5) * 0.00003;
    points.push({ t: new Date(opts.start.getTime() + t * 1000), lon: lon + jitter(), lat: lat + jitter() });
    s += (step / paceAt(s)) * 1000;
    t += step;
  }
  const [lon, lat] = positionAt(opts.route, opts.distanceM, opts.loop);
  points.push({ t: new Date(opts.start.getTime() + t * 1000), lon, lat });
  return points;
}

export function toGpx(name: string, points: ReturnType<typeof trackPoints>) {
  const body = points
    .map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${p.t.toISOString()}</time></trkpt>`)
    .join("\n");
  const esc = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="HYD Runners demo seed (sample data)" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><desc>Sample activity generated for local demo data. Not a real recording.</desc></metadata>
<trk><name>${esc}</name><trkseg>
${body}
</trkseg></trk></gpx>`;
}
