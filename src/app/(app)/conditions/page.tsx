import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import {
  AirQualityNote,
  Attribution,
  ConditionsSummary,
  LEVEL_CLASS,
  LEVEL_LABEL,
  timeLabel,
} from "@/features/conditions/components/conditions-summary";
import { loadConditions } from "@/features/conditions/server";

export const metadata: Metadata = { title: "Running conditions" };

export default async function ConditionsPage({ searchParams }: PageProps<"/conditions">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Running conditions"
      description="Heat, humidity, rain, wind and UV for the next 24 hours, and when it's best to run."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="conditions" />
      </>
    );
  const sp = await searchParams;
  const placeId = typeof sp.place === "string" ? sp.place : null;
  const { place, places, forecast, hours, rec, aq } = await loadConditions(ctx.supabase, placeId);

  return (
    <>
      {header}
      <div className="space-y-6">
        <form method="get" action="/conditions" className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="cond-place">Place</Label>
            <select
              id="cond-place"
              name="place"
              defaultValue={place.id ?? ""}
              className="h-9 max-w-xs rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Hyderabad (city centre)</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
        <ConditionsSummary forecast={forecast} rec={rec} aq={aq} placeName={place.name} />
        {forecast && hours.length > 0 && (
          <section className="space-y-2" aria-labelledby="hourly">
            <h2 id="hourly" className="font-semibold text-brand-navy">
              Next {hours.length} hours
            </h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <caption className="sr-only">Hourly running conditions</caption>
                <thead className="bg-muted text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Time
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Running
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Temp (feels)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Humidity
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Rain
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Wind
                    </th>
                    <th scope="col" className="px-3 py-2">
                      UV (clear sky)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h.time} className="border-t align-top">
                      <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap">
                        {timeLabel(h.time)}
                        {h.dark ? " 🌙" : ""}
                      </th>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 ${LEVEL_CLASS[h.level]}`}>{LEVEL_LABEL[h.level]}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {Math.round(h.tempC)}°C{h.apparentC !== null ? ` (${Math.round(h.apparentC)}°C)` : ""}
                      </td>
                      <td className="px-3 py-2">{h.humidityPct === null ? "—" : `${Math.round(h.humidityPct)}%`}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{h.precipMm === null ? "—" : `${h.precipMm} mm`}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {h.windMs === null ? "—" : `${Math.round(h.windMs * 3.6)} km/h`}
                      </td>
                      <td className="px-3 py-2">{h.uvClearSky === null || h.dark ? "—" : Math.round(h.uvClearSky)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{h.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AirQualityNote aq={aq} />
            <Attribution forecast={forecast} />
            <p className="text-xs text-muted-foreground">
              The running rating is a simple guide to heat, humidity, rain, wind, UV and daylight, not medical advice.
              Listen to your body, carry water, and slow down in the heat.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
