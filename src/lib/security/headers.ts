/**
 * Security response headers, applied to every route by `headers()` in
 * next.config.ts. Pure (no `process.env` reads here) so it can be unit tested;
 * next.config.ts passes in the build-time environment.
 *
 * Content Security Policy is rolled out in two layers:
 *
 * 1. An ENFORCED baseline (`Content-Security-Policy`) with only directives
 *    that cannot break the app: no framing, no plugins, no `<base>` hijack, and
 *    forms post only to this origin (Server Actions and sign-in/out all post
 *    and redirect same-origin).
 * 2. A full `Content-Security-Policy-Report-Only` policy listing exactly the
 *    origins the app loads from. Violations are reported to
 *    /api/v1/csp-report and nothing is blocked.
 *
 * Known gap before the full policy can be enforced: `script-src` allows
 * `'unsafe-inline'`. Next.js inlines its bootstrap/RSC payload scripts, and the
 * only ways to allow them without `'unsafe-inline'` are per-request nonces
 * (which force every page to render dynamically, see
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md) or
 * the experimental SRI mode. `style-src 'unsafe-inline'` is accepted: React
 * `style` props, Leaflet (positions tiles/markers with inline styles) and
 * Recharts all set inline styles.
 */

export type SecurityHeadersEnv = {
  /** `process.env.NODE_ENV` at build time. */
  nodeEnv?: string;
  /** `process.env.VERCEL_ENV`: "production" | "preview" | "development" | undefined. */
  vercelEnv?: string;
  /** `NEXT_PUBLIC_SUPABASE_URL`; the browser uploads timetables to signed Storage URLs on it. */
  supabaseUrl?: string;
  /** `NEXT_PUBLIC_MAP_TILE_URL`; Leaflet loads raster tiles from it. */
  mapTileUrl?: string;
};

export type Header = { key: string; value: string };

export const CSP_REPORT_PATH = "/api/v1/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";
export const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Sources the Vercel Toolbar (comments/feedback) needs on Preview deployments only. */
const VERCEL_TOOLBAR = {
  script: ["https://vercel.live"],
  style: ["https://vercel.live"],
  img: ["https://vercel.live", "https://vercel.com"],
  font: ["https://vercel.live", "https://assets.vercel.com"],
  connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
  frame: ["https://vercel.live"],
};

/** Browser features the app never uses. `web-share` and clipboard stay on for the share buttons. */
const DENIED_FEATURES = [
  "accelerometer",
  "autoplay",
  "camera",
  "display-capture",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
];

/** `https://host[:port]` of an absolute http(s) URL, or null. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * CSP source for a Leaflet tile URL template. `{s}` subdomain placeholders
 * become a `*.` wildcard (`https://{s}.tile.example.org/...` →
 * `https://*.tile.example.org`). Anything unusual yields null (not allowed).
 */
export function tileSource(template: string | undefined): string | null {
  const match = /^(https?):\/\/([^/?#]+)/.exec(template ?? "");
  if (!match) return null;
  const [, scheme, host] = match;
  const wildcard = host.replace(/^\{s\}\./, "*.");
  if (!/^(\*\.)?[A-Za-z0-9.-]+(:\d+)?$/.test(wildcard)) return null;
  return `${scheme}://${wildcard.toLowerCase()}`;
}

function serialize(directives: Record<string, string[]>) {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources)].join(" "))
    .join("; ");
}

const BASELINE: Record<string, string[]> = {
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

const REPORTING: Record<string, string[]> = {
  "report-uri": [CSP_REPORT_PATH],
  "report-to": [CSP_REPORT_GROUP],
};

/** Enforced baseline policy. Safe to block on: none of it affects how pages load. */
export function enforcedCsp(): string {
  return serialize({ ...BASELINE, ...REPORTING });
}

/** The full policy, sent report-only until the inline-script gap is closed. */
export function reportOnlyCsp(env: SecurityHeadersEnv): string {
  const isDev = env.nodeEnv === "development";
  const preview = env.vercelEnv === "preview";
  const toolbar = (key: keyof typeof VERCEL_TOOLBAR) => (preview ? VERCEL_TOOLBAR[key] : []);

  const supabase = originOf(env.supabaseUrl);
  const tiles = tileSource(env.mapTileUrl || DEFAULT_MAP_TILE_URL);

  return serialize({
    "default-src": ["'self'"],
    // 'unsafe-inline': Next.js inline bootstrap scripts (see module comment).
    // 'unsafe-eval' only in development: React rebuilds server error stacks with eval.
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...toolbar("script")],
    "style-src": ["'self'", "'unsafe-inline'", ...toolbar("style")],
    // data:/blob: — Leaflet CSS sprites and next/image placeholders; tiles from the map provider.
    "img-src": ["'self'", "data:", "blob:", ...(tiles ? [tiles] : []), ...toolbar("img")],
    // next/font self-hosts Geist under /_next/static.
    "font-src": ["'self'", ...toolbar("font")],
    // Supabase: direct uploads to signed Storage URLs. 'self' covers the dev HMR websocket.
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), ...toolbar("connect")],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
    "frame-src": preview ? toolbar("frame") : ["'none'"],
    ...BASELINE,
    ...REPORTING,
  });
}

/**
 * Features allowed for this origin only, never for embedded or third-party
 * frames. Geolocation is used solely by opt-in live sharing during a group
 * run (/events/[id]/live), after the runner taps "Share my location".
 */
const SELF_ONLY_FEATURES = ["geolocation"];

export function permissionsPolicy(): string {
  return [...DENIED_FEATURES.map((feature) => `${feature}=()`), ...SELF_ONLY_FEATURES.map((f) => `${f}=(self)`)].join(
    ", ",
  );
}

/** Every security header the app sends, for all routes. */
export function securityHeaders(env: SecurityHeadersEnv): Header[] {
  return [
    // No `preload`: being on the browser preload list is hard to undo.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: permissionsPolicy() },
    { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
    { key: "Content-Security-Policy", value: enforcedCsp() },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp(env) },
  ];
}
