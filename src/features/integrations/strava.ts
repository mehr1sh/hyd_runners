import { z } from "zod";
import type { ActivityType, ParsedActivity, RawSample } from "@/features/activities/logic/normalize";

/**
 * Strava API v3 client (OAuth 2 and read-only activity import). Pure apart
 * from the injected fetch, and not wired to any route until the integration
 * is approved and configured (see docs/integrations.md).
 *
 * Scope: activity:read only (never activity:read_all, profile or write).
 * Imported data must stay private to its owner and must not be sent to AI
 * providers, per Strava's API agreement.
 */

export const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
export const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
export const STRAVA_API = "https://www.strava.com/api/v3";
export const STRAVA_SCOPE = "activity:read";

export type StravaConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function authorizeUrl(cfg: StravaConfig, state: string) {
  const u = new URL(STRAVA_AUTHORIZE);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", STRAVA_SCOPE);
  u.searchParams.set("state", state);
  return u.toString();
}

export const TokenResponse = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(10),
  expires_at: z.number().int(),
  athlete: z.object({ id: z.number() }).optional(),
});
export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; athleteId: number | null };

export class StravaError extends Error {
  constructor(
    readonly kind: "auth" | "rate_limited" | "scope" | "server" | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "StravaError";
  }
}

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new StravaError("auth", "Strava rejected the token.");
  if (res.status === 403) throw new StravaError("scope", "Strava denied access to that data.");
  if (res.status === 429) throw new StravaError("rate_limited", "Strava's rate limit was reached.");
  if (!res.ok) throw new StravaError("server", `Strava returned ${res.status}.`);
  return res.json();
}

async function tokenRequest(cfg: StravaConfig, body: Record<string, string>, fetchImpl: typeof fetch): Promise<Tokens> {
  const json = await call(fetchImpl, STRAVA_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
  });
  const t = TokenResponse.safeParse(json);
  if (!t.success) throw new StravaError("malformed", "Unexpected token response.");
  return {
    accessToken: t.data.access_token,
    refreshToken: t.data.refresh_token,
    expiresAt: t.data.expires_at,
    athleteId: t.data.athlete?.id ?? null,
  };
}

/** The code exchange must confirm the granted scope includes activity:read. */
export async function exchangeCode(cfg: StravaConfig, code: string, grantedScope: string, fetchImpl: typeof fetch = fetch) {
  if (!grantedScope.split(",").includes(STRAVA_SCOPE))
    throw new StravaError("scope", "Activity access was not granted.");
  return tokenRequest(cfg, { code, grant_type: "authorization_code" }, fetchImpl);
}

export function refreshTokens(cfg: StravaConfig, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(cfg, { refresh_token: refreshToken, grant_type: "refresh_token" }, fetchImpl);
}

/** Refresh an hour before expiry (Strava tokens last six hours). */
export const needsRefresh = (t: { expiresAt: number }, nowMs: number) => t.expiresAt * 1000 - nowMs < 3_600_000;

export const SummaryActivity = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  sport_type: z.string(),
  start_date: z.string(),
  elapsed_time: z.number(),
  moving_time: z.number(),
  distance: z.number(),
  manual: z.boolean().optional(),
});
export type SummaryActivity = z.infer<typeof SummaryActivity>;

const TYPE: Record<string, ActivityType> = {
  Run: "run",
  TrailRun: "run",
  VirtualRun: "run",
  Walk: "walk",
  Hike: "hike",
};
export const importableType = (sportType: string) => TYPE[sportType] ?? null;

/** Activities after an epoch second, one page; non-foot and manual entries are skipped by the caller. */
export async function listActivities(
  accessToken: string,
  afterEpoch: number,
  page: number,
  fetchImpl: typeof fetch = fetch,
) {
  const url = `${STRAVA_API}/athlete/activities?after=${afterEpoch}&page=${page}&per_page=50`;
  const json = await call(fetchImpl, url, { headers: { authorization: `Bearer ${accessToken}` } });
  return z.array(SummaryActivity).parse(json);
}

const Stream = z.object({ data: z.array(z.unknown()) });
const Streams = z.object({
  time: Stream,
  latlng: Stream.optional(),
  altitude: Stream.optional(),
  distance: Stream.optional(),
  heartrate: Stream.optional(),
  cadence: Stream.optional(),
});

export async function fetchStreams(accessToken: string, id: number, fetchImpl: typeof fetch = fetch) {
  const keys = "time,latlng,altitude,distance,heartrate,cadence";
  const json = await call(fetchImpl, `${STRAVA_API}/activities/${id}/streams?keys=${keys}&key_by_type=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const s = Streams.safeParse(json);
  if (!s.success) throw new StravaError("malformed", "Unexpected streams response.");
  return s.data;
}

/** Strava streams to the provider-neutral ParsedActivity used by every import. */
export function streamsToParsed(a: SummaryActivity, streams: z.infer<typeof Streams>): ParsedActivity {
  const start = Date.parse(a.start_date);
  const time = streams.time.data as number[];
  const at = <T>(s: { data: unknown[] } | undefined, i: number) => (s ? ((s.data[i] as T | undefined) ?? null) : null);
  const samples: RawSample[] = time.map((t, i) => {
    const ll = at<[number, number]>(streams.latlng, i);
    return {
      t: start + t * 1000,
      lat: ll ? ll[0] : null,
      lon: ll ? ll[1] : null,
      ele: at<number>(streams.altitude, i),
      dist: at<number>(streams.distance, i),
      hr: at<number>(streams.heartrate, i),
      cadence: at<number>(streams.cadence, i),
    };
  });
  return {
    format: "app",
    samples,
    detectedType: importableType(a.sport_type),
    deviceMovingSeconds: a.moving_time > 0 ? a.moving_time : null,
    name: a.name ?? null,
  };
}
