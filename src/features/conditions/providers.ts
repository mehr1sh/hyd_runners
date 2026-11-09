import "server-only";
import type { AirQualityStatus, Forecast, HourConditions } from "./logic";

/**
 * Weather providers.
 *
 * - `met_norway` (default): MET Norway Locationforecast 2.0. Free, no account,
 *   commercial use permitted (NLOD 2.0 / CC BY 4.0) with the credit "Data from
 *   MET Norway". Their terms require an identifying User-Agent, at most 4
 *   decimals in coordinates, and no repeat request before `Expires`.
 * - `sample`: a fixed, clearly labelled sample for tests and offline
 *   development. Never presented as live weather.
 *
 * Select with CONDITIONS_PROVIDER=met_norway|sample.
 */

const USER_AGENT = "hyd-runners/1.0 (+https://hydrunners.vercel.app; github.com/mehr1sh/hyd_runners)";
const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete";

type MetSeries = {
  time: string;
  data: {
    instant: { details: Record<string, number | undefined> };
    next_1_hours?: { details?: { precipitation_amount?: number } };
  };
};

/** Normalise a Locationforecast 2.0 response to hourly conditions (hourly entries only). */
export function parseMetNorway(json: unknown): { updatedAt: string | null; hours: HourConditions[] } {
  const props = (json as { properties?: { meta?: { updated_at?: string }; timeseries?: MetSeries[] } })?.properties;
  if (!props || !Array.isArray(props.timeseries)) throw new Error("Unexpected MET Norway response");
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const hours: HourConditions[] = [];
  for (const t of props.timeseries) {
    const d = t.data?.instant?.details ?? {};
    const temp = n(d.air_temperature);
    if (!t.data?.next_1_hours || temp === null) continue; // 6-hourly tail: not hourly data
    hours.push({
      time: new Date(t.time).toISOString(),
      tempC: temp,
      apparentC: n(d.apparent_air_temperature),
      humidityPct: n(d.relative_humidity),
      dewPointC: n(d.dew_point_temperature),
      windMs: n(d.wind_speed),
      uvClearSky: n(d.ultraviolet_index_clear_sky),
      precipMm: n(t.data.next_1_hours.details?.precipitation_amount),
      aqi: null,
    });
  }
  return { updatedAt: props.meta?.updated_at ?? null, hours };
}

type CacheEntry = { expires: number; lastModified: string | null; body: unknown };
const cache = new Map<string, CacheEntry>();

async function metNorway(lat: number, lon: number): Promise<Forecast> {
  // Two decimals (~1 km) keeps requests cacheable and well within the 4-decimal rule.
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  let body = hit?.body;
  if (!hit || hit.expires <= Date.now()) {
    const res = await fetch(`${MET_URL}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, {
      headers: {
        "User-Agent": USER_AGENT,
        ...(hit?.lastModified ? { "If-Modified-Since": hit.lastModified } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 304 && hit) {
      body = hit.body;
    } else if (res.ok) {
      body = await res.json();
    } else {
      throw new Error(`MET Norway responded ${res.status}`);
    }
    const expires = Date.parse(res.headers.get("expires") ?? "");
    cache.set(key, {
      expires: Number.isFinite(expires) ? expires : Date.now() + 30 * 60_000,
      lastModified: res.headers.get("last-modified") ?? hit?.lastModified ?? null,
      body,
    });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  const parsed = parseMetNorway(body);
  return {
    source: "met_norway",
    live: true,
    attribution: "Data from MET Norway",
    attributionUrl: "https://api.met.no/doc/License",
    ...parsed,
  };
}

/** A fixed sample day, re-dated to start at the current hour. Labelled as sample data everywhere. */
export function sampleForecast(nowMs: number): Forecast {
  const start = nowMs - (nowMs % 3_600_000);
  const temps = [24, 23, 23, 22, 22, 23, 25, 27, 29, 31, 32, 33, 33, 32, 31, 29, 27, 26, 25, 25, 24, 24, 23, 23];
  const hours: HourConditions[] = Array.from({ length: 36 }, (_, i) => {
    const local = new Date(start + i * 3_600_000 + 330 * 60_000).getUTCHours();
    const t = temps[local];
    return {
      time: new Date(start + i * 3_600_000).toISOString(),
      tempC: t,
      apparentC: t + (t > 28 ? 2 : 0),
      humidityPct: 55,
      dewPointC: 17,
      windMs: 3,
      uvClearSky: local >= 10 && local <= 15 ? 8 : local >= 8 && local <= 16 ? 4 : 0,
      precipMm: local === 17 ? 1.5 : 0,
      aqi: null,
    };
  });
  return {
    source: "sample",
    live: false,
    attribution: "Sample data for testing. Not live weather.",
    attributionUrl: "",
    updatedAt: null,
    hours,
  };
}

export function conditionsProvider() {
  return process.env.CONDITIONS_PROVIDER === "sample" ? "sample" : "met_norway";
}

export async function getForecast(lat: number, lon: number, nowMs: number): Promise<Forecast | null> {
  if (conditionsProvider() === "sample") return sampleForecast(nowMs);
  try {
    return await metNorway(lat, lon);
  } catch (error) {
    console.error(`[conditions] forecast failed: ${(error as Error)?.name ?? "Error"}`);
    return null;
  }
}

/**
 * Air quality needs a provider the owner chooses: every source with hourly
 * Hyderabad data and commercial-use terms requires an account or key (see
 * docs/run-conditions.md). Until one is configured, AQI is reported as not
 * configured and never estimated.
 */
export function airQualityStatus(): AirQualityStatus {
  return { status: "not_configured" };
}
