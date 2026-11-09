import Link from "next/link";
import { CloudSun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AirQualityStatus, Forecast, Level, Recommendation } from "../logic";

export const LEVEL_LABEL: Record<Level, string> = { good: "Good", fair: "Fair", poor: "Poor", avoid: "Avoid" };
export const LEVEL_CLASS: Record<Level, string> = {
  good: "bg-emerald-100 text-emerald-900",
  fair: "bg-amber-100 text-amber-900",
  poor: "bg-orange-100 text-orange-900",
  avoid: "bg-red-100 text-red-900",
};

export function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(
    new Date(iso),
  );
}

export function Attribution({ forecast }: { forecast: Forecast }) {
  return forecast.live ? (
    <p className="text-xs text-muted-foreground">
      <a href={forecast.attributionUrl} className="underline underline-offset-2" rel="noreferrer" target="_blank">
        {forecast.attribution}
      </a>
      {forecast.updatedAt ? ` · forecast updated ${timeLabel(forecast.updatedAt)}` : ""}
    </p>
  ) : (
    <p className="text-xs font-medium text-amber-900" role="note">
      {forecast.attribution}
    </p>
  );
}

export function AirQualityNote({ aq }: { aq: AirQualityStatus }) {
  if (aq.status === "ok") return null;
  return (
    <p className="text-xs text-muted-foreground">
      Air quality isn&apos;t included yet: no air-quality provider is set up. Check a local source before running on
      hazy days.
    </p>
  );
}

/** The "run now or later?" answer, used on the dashboard and the conditions page. */
export function ConditionsSummary({
  forecast,
  rec,
  aq,
  placeName,
  compact = false,
}: {
  forecast: Forecast | null;
  rec: Recommendation;
  aq: AirQualityStatus;
  placeName: string;
  compact?: boolean;
}) {
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="run-now">
      <div className="flex items-center justify-between gap-2">
        <h2 id="run-now" className="flex items-center gap-2 font-semibold text-brand-navy">
          <CloudSun className="size-4" aria-hidden /> Run now or later?
        </h2>
        {forecast && !forecast.live && <Badge variant="outline">Sample data</Badge>}
      </div>
      {!forecast || rec.kind === "no_data" ? (
        <p className="text-sm text-muted-foreground">The forecast is unavailable right now. Try again later.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{placeName}</p>
          {rec.kind === "now" && (
            <p className="text-lg font-semibold">
              Go now{" "}
              <span className={`rounded px-2 py-0.5 text-sm ${LEVEL_CLASS[rec.now.level]}`}>
                {LEVEL_LABEL[rec.now.level]}
              </span>
            </p>
          )}
          {rec.kind === "later" && (
            <p className="text-lg font-semibold">
              Better at {timeLabel(rec.best.time)}{" "}
              <span className={`rounded px-2 py-0.5 text-sm ${LEVEL_CLASS[rec.best.level]}`}>
                {LEVEL_LABEL[rec.best.level]}
              </span>
            </p>
          )}
          {rec.kind === "none_good" && <p className="text-lg font-semibold">No good window soon</p>}
          <p className="text-sm">
            Now: {Math.round(rec.now.tempC)}°C
            {rec.now.apparentC !== null ? `, feels like ${Math.round(rec.now.apparentC)}°C` : ""}
            {rec.now.reasons.length ? ` · ${rec.now.reasons.join("; ")}` : " · comfortable"}
          </p>
          {rec.kind !== "now" && <p className="text-sm text-muted-foreground">{rec.reason}</p>}
          {!compact && <AirQualityNote aq={aq} />}
          <Attribution forecast={forecast} />
          {compact && (
            <Link href="/conditions" className="text-sm underline underline-offset-4">
              Hourly forecast
            </Link>
          )}
        </>
      )}
    </section>
  );
}
