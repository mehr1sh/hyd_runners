/**
 * Running conditions: provider-neutral types, the hour score, sun times and
 * the "run now or later" recommendation. Pure functions only.
 *
 * The score is a simple, explained heuristic for comfort and safety, not a
 * medical judgement; every deduction comes with a plain-language reason.
 */

export type HourConditions = {
  /** ISO start of the hour (UTC). */
  time: string;
  tempC: number;
  apparentC: number | null;
  humidityPct: number | null;
  dewPointC: number | null;
  windMs: number | null;
  /** UV index assuming a clear sky (an upper bound). */
  uvClearSky: number | null;
  /** Precipitation expected during the hour, mm. */
  precipMm: number | null;
  /** Air quality index (US EPA scale) when an AQI provider is configured. */
  aqi: number | null;
};

export type Forecast = {
  source: "met_norway" | "sample";
  live: boolean;
  attribution: string;
  attributionUrl: string;
  updatedAt: string | null;
  hours: HourConditions[];
};

export type AirQualityStatus =
  { status: "ok"; source: string; attribution: string } | { status: "not_configured" } | { status: "unavailable" };

export type Level = "good" | "fair" | "poor" | "avoid";
export type HourScore = { score: number; level: Level; reasons: string[]; dark: boolean };

/** Heat index (°C) from temperature and relative humidity (NOAA/Rothfusz), used when no apparent temperature is given. */
export function heatIndexC(tempC: number, rh: number) {
  const t = (tempC * 9) / 5 + 32;
  if (t < 80) return tempC;
  const hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  return ((hi - 32) * 5) / 9;
}

export function scoreHour(h: HourConditions, dark: boolean): HourScore {
  let score = 100;
  let avoid = false;
  const reasons: string[] = [];
  const feels = h.apparentC ?? (h.humidityPct !== null ? heatIndexC(h.tempC, h.humidityPct) : h.tempC);
  const f = Math.round(feels);
  if (feels > 38) {
    avoid = true;
    reasons.push(`Dangerous heat: feels like ${f}°C`);
  } else if (feels > 33) {
    score -= 50;
    reasons.push(`Very hot: feels like ${f}°C`);
  } else if (feels > 29) {
    score -= 30;
    reasons.push(`Hot: feels like ${f}°C`);
  } else if (feels > 26) {
    score -= 12;
    reasons.push(`Warm: feels like ${f}°C`);
  }
  if (h.dewPointC !== null && h.dewPointC >= 24) {
    score -= 20;
    reasons.push(`Very humid (dew point ${Math.round(h.dewPointC)}°C)`);
  } else if (h.dewPointC !== null && h.dewPointC >= 20) {
    score -= 8;
    reasons.push(`Humid (dew point ${Math.round(h.dewPointC)}°C)`);
  }
  if (h.precipMm !== null && h.precipMm >= 4) {
    avoid = true;
    reasons.push(`Heavy rain expected (${h.precipMm} mm)`);
  } else if (h.precipMm !== null && h.precipMm >= 1) {
    score -= 30;
    reasons.push(`Rain expected (${h.precipMm} mm)`);
  } else if (h.precipMm !== null && h.precipMm >= 0.2) {
    score -= 10;
    reasons.push("Light rain possible");
  }
  if (h.windMs !== null && h.windMs >= 14) {
    avoid = true;
    reasons.push(`Very strong wind (${Math.round(h.windMs * 3.6)} km/h)`);
  } else if (h.windMs !== null && h.windMs >= 9) {
    score -= 15;
    reasons.push(`Strong wind (${Math.round(h.windMs * 3.6)} km/h)`);
  }
  if (!dark && h.uvClearSky !== null && h.uvClearSky >= 8) {
    score -= 20;
    reasons.push(`Very high UV (${Math.round(h.uvClearSky)} on a clear sky)`);
  } else if (!dark && h.uvClearSky !== null && h.uvClearSky >= 6) {
    score -= 10;
    reasons.push(`High UV (${Math.round(h.uvClearSky)} on a clear sky)`);
  }
  if (h.aqi !== null && h.aqi > 200) {
    avoid = true;
    reasons.push(`Very unhealthy air (AQI ${h.aqi})`);
  } else if (h.aqi !== null && h.aqi > 150) {
    score -= 40;
    reasons.push(`Unhealthy air (AQI ${h.aqi})`);
  } else if (h.aqi !== null && h.aqi > 100) {
    score -= 20;
    reasons.push(`Air unhealthy for sensitive groups (AQI ${h.aqi})`);
  }
  if (dark) {
    score -= 5;
    reasons.push("Dark: pick a lit route and wear something visible");
  }
  score = Math.max(0, Math.min(100, score));
  const level: Level = avoid ? "avoid" : score >= 75 ? "good" : score >= 50 ? "fair" : "poor";
  return { score: avoid ? 0 : score, level, reasons, dark };
}

/** Sunrise and sunset (UTC ms) for the local date containing `dayMs`, NOAA approximation (±2 min). */
export function sunTimes(dayMs: number, lat: number, lon: number, tzOffsetMin = 330) {
  const local = new Date(dayMs + tzOffsetMin * 60_000);
  const startOfYear = Date.UTC(local.getUTCFullYear(), 0, 1);
  const n =
    Math.floor((Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - startOfYear) / 86_400_000) +
    1;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const rad = (lat * Math.PI) / 180;
  const cosH = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(rad) * Math.cos(decl)) - Math.tan(rad) * Math.tan(decl);
  const ha = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI;
  const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sunrise = midnightUtc + (720 - 4 * (lon + ha) - eqTime) * 60_000;
  const sunset = midnightUtc + (720 - 4 * (lon - ha) - eqTime) * 60_000;
  return { sunrise, sunset };
}

export function isDark(timeMs: number, lat: number, lon: number) {
  const { sunrise, sunset } = sunTimes(timeMs, lat, lon);
  return timeMs < sunrise || timeMs >= sunset;
}

export type ScoredHour = HourConditions & HourScore;

export type Recommendation =
  | { kind: "no_data" }
  | { kind: "now"; now: ScoredHour; reason: string }
  | { kind: "later"; now: ScoredHour; best: ScoredHour; reason: string }
  | { kind: "none_good"; now: ScoredHour; best: ScoredHour | null; reason: string };

/** Hourly scores from the current hour on (at most `limit` hours). */
export function scoreForecast(f: Forecast, nowMs: number, lat: number, lon: number, limit = 24): ScoredHour[] {
  const hourStart = nowMs - (nowMs % 3_600_000);
  return f.hours
    .filter((h) => new Date(h.time).getTime() >= hourStart)
    .slice(0, limit)
    .map((h) => ({ ...h, ...scoreHour(h, isDark(new Date(h.time).getTime() + 1_800_000, lat, lon)) }));
}

/**
 * Run now, or wait? Looks at the next 12 hours, but only at sensible running
 * hours (05:00–21:59 local). "Later" is suggested only when it is clearly
 * better (at least 15 points) than now.
 */
export function recommend(hours: ScoredHour[], tzOffsetMin = 330): Recommendation {
  if (hours.length === 0) return { kind: "no_data" };
  const now = hours[0];
  const localHour = (h: ScoredHour) => new Date(new Date(h.time).getTime() + tzOffsetMin * 60_000).getUTCHours();
  const candidates = hours.slice(1, 13).filter((h) => localHour(h) >= 5 && localHour(h) <= 21);
  const best = candidates.reduce<ScoredHour | null>((b, h) => (!b || h.score > b.score ? h : b), null);
  if (now.level !== "avoid" && now.score >= 75 && (!best || best.score - now.score < 15)) {
    return { kind: "now", now, reason: "Conditions are good right now." };
  }
  if (best && best.level !== "avoid" && best.score >= 50 && best.score - now.score >= 15) {
    return {
      kind: "later",
      now,
      best,
      reason: best.reasons.length
        ? `Then: ${best.reasons.join("; ")}.`
        : `Then: about ${Math.round(best.apparentC ?? best.tempC)}°C and comfortable.`,
    };
  }
  if (now.level !== "avoid" && now.score >= 50) {
    return { kind: "now", now, reason: "Conditions are fair now and don’t clearly improve in the next 12 hours." };
  }
  return {
    kind: "none_good",
    now,
    best,
    reason: "No comfortable window in the next 12 hours. Consider an indoor session or a short, easy run.",
  };
}
