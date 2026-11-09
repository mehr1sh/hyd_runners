import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchPlaces } from "@/features/routes/queries";
import { recommend, scoreForecast } from "./logic";
import { airQualityStatus, getForecast } from "./providers";

export const CITY_CENTRE = { id: null, name: "Hyderabad (city centre)", lat: 17.385, lon: 78.4867 };

/** Forecast, hourly scores and recommendation for a place (a location id) or the city centre. */
export async function loadConditions(supabase: SupabaseClient, placeId: string | null) {
  const places = await searchPlaces(supabase);
  const found = placeId ? places.find((p) => p.id === placeId) : undefined;
  const place = found ? { id: found.id, name: found.name, lat: found.lat, lon: found.lon } : CITY_CENTRE;
  const now = Date.now();
  const forecast = await getForecast(place.lat, place.lon, now);
  const hours = forecast ? scoreForecast(forecast, now, place.lat, place.lon, 24) : [];
  return { now, place, places, forecast, hours, rec: recommend(hours), aq: airQualityStatus() };
}
