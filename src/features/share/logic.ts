/**
 * Share cards: pure helpers (no rendering) so the privacy rules are testable.
 *
 * Privacy rules, enforced here and in the route handlers:
 * - only the owner can render a card for their activity or challenge;
 * - the route drawn is the privacy-trimmed `public_path`, never the full track;
 * - only the date is shown, never the start time (it reveals routines);
 * - the runner can hide the route and the pace;
 * - heart rate, cadence and exact coordinates never appear on a card.
 */

export const CARD_FORMATS = {
  square: { width: 1080, height: 1080, label: "Square (1080×1080)" },
  story: { width: 1080, height: 1920, label: "Story (1080×1920)" },
  wide: { width: 1200, height: 630, label: "Wide (1200×630)" },
} as const;
export type CardFormat = keyof typeof CARD_FORMATS;

/** Poster styles. Every theme draws the same real data: only colours and layout change. */
export const CARD_THEMES = {
  classic: "Classic",
  neon: "Neon route (dark)",
  minimal: "Minimal city line",
  elevation: "Elevation profile",
} as const;
export type CardTheme = keyof typeof CARD_THEMES;

export type CardOptions = { format: CardFormat; showRoute: boolean; showPace: boolean; theme?: CardTheme };

export function parseCardOptions(params: URLSearchParams): CardOptions {
  const f = params.get("format");
  return {
    format: f && Object.hasOwn(CARD_FORMATS, f) ? (f as CardFormat) : "square",
    showRoute: params.get("route") !== "0",
    showPace: params.get("pace") !== "0",
    theme: ((t) => (t && Object.hasOwn(CARD_THEMES, t) ? (t as CardTheme) : "classic"))(params.get("theme")),
  };
}

export function cardQuery(o: CardOptions) {
  const p = new URLSearchParams({ format: o.format });
  if (!o.showRoute) p.set("route", "0");
  if (!o.showPace) p.set("pace", "0");
  if (o.theme && o.theme !== "classic") p.set("theme", o.theme);
  return p.toString();
}

/**
 * An SVG path for [lon, lat] coordinates fitted into a w×h box with padding,
 * keeping the aspect ratio (longitude scaled by cos(latitude)). Null when there
 * is nothing to draw. Coordinates are reduced to at most 400 points and
 * rounded to whole pixels, so the card carries the shape only.
 */
export function routeSvgPath(coords: [number, number][] | null, w: number, h: number, pad = 0) {
  if (!coords || coords.length < 2) return null;
  const step = Math.max(1, Math.ceil(coords.length / 400));
  const pts = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  const midLat = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * kx);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return pts
    .map((_, i) => {
      const x = Math.round(offX + (xs[i] - minX) * scale);
      const y = Math.round(offY + (maxY - ys[i]) * scale);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

/** "9 Nov 2026" in Hyderabad time. The time of day is deliberately left out. */
export function cardDate(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function safeFilename(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "hyd-runners"
  );
}

/** SVG path for an elevation profile ([distance m, elevation m] pairs), scaled to fit. */
export function elevationSvgPath(profile: [number, number][] | null, w: number, h: number) {
  if (!profile || profile.length < 2) return null;
  const xs = profile.map((p) => p[0]);
  const ys = profile.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => Math.round(((x - x0) / Math.max(1, x1 - x0)) * w);
  const sy = (y: number) => Math.round(h - ((y - y0) / Math.max(1, y1 - y0)) * (h * 0.85) - h * 0.05);
  const step = Math.max(1, Math.floor(profile.length / 300));
  const pts = profile.filter((_, i) => i % step === 0 || i === profile.length - 1);
  return `M0 ${h} ${pts.map((p) => `L${sx(p[0])} ${sy(p[1])}`).join(" ")} L${w} ${h} Z`;
}
