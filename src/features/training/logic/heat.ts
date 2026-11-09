/**
 * Heat-aware guidance for a planned session, from the forecast's
 * feels-like temperature and humidity. The bands are conservative coaching
 * heuristics (pace slows in heat and humidity; effort matters more than pace),
 * not physiological measurements, and they never replace listening to your
 * body. Signs of heat illness mean stopping, not adjusting pace.
 */

export type HeatBand = "none" | "warm" | "hot" | "very_hot" | "extreme";
export type Intensity = "easy" | "quality" | "long";

export type HeatAdvice = {
  band: HeatBand;
  /** Expected slow-down at the same effort, as a percentage range. */
  slowdownPct: [number, number] | null;
  advice: string[];
  basis: string;
};

const BANDS: { band: HeatBand; below: number; slow: [number, number] | null }[] = [
  { band: "none", below: 24, slow: null },
  { band: "warm", below: 28, slow: [2, 4] },
  { band: "hot", below: 32, slow: [4, 8] },
  { band: "very_hot", below: 36, slow: [8, 12] },
  { band: "extreme", below: Infinity, slow: null },
];

export function heatAdvice(
  feelsLikeC: number,
  humidityPct: number | null,
  minutes: number,
  intensity: Intensity,
): HeatAdvice {
  // Humid air (dew point territory) feels hotter than the number suggests: bump one band.
  const humid = humidityPct !== null && humidityPct >= 75 && feelsLikeC >= 24;
  let idx = BANDS.findIndex((b) => feelsLikeC < b.below);
  if (humid) idx = Math.min(BANDS.length - 1, idx + 1);
  const { band, slow } = BANDS[idx];
  const advice: string[] = [];
  const basis = `Feels like ${Math.round(feelsLikeC)}°C${humidityPct !== null ? `, ${Math.round(humidityPct)}% humidity` : ""}`;

  if (band === "none") return { band, slowdownPct: null, advice: ["No heat adjustment needed."], basis };
  if (band === "extreme") {
    advice.push("Avoid hard efforts in this heat. Run very early, move indoors, or rest.");
    advice.push("Stop and cool down if you feel dizzy, confused, nauseous or stop sweating.");
    return { band, slowdownPct: null, advice, basis };
  }
  advice.push(`Run by effort, not pace: expect to be about ${slow![0]}–${slow![1]}% slower at the same effort.`);
  if (intensity === "quality" && (band === "hot" || band === "very_hot"))
    advice.push(
      band === "very_hot"
        ? "Swap the hard session for an easy run, or do it in the cool of early morning."
        : "Shorten the hard reps or extend the recoveries.",
    );
  if (intensity === "long" || minutes >= 60)
    advice.push("Carry water and drink to thirst; plan a route with shade or water stops.");
  if (band !== "warm") advice.push("Stop and cool down if you feel dizzy, confused, nauseous or stop sweating.");
  return { band, slowdownPct: slow, advice, basis };
}

export const HEAT_LABEL: Record<HeatBand, string> = {
  none: "Comfortable",
  warm: "Warm",
  hot: "Hot",
  very_hot: "Very hot",
  extreme: "Extreme heat",
};
