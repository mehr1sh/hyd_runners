/** Great-circle helpers. Same formula and Earth radius as the web normaliser. */

const R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance in metres between two WGS84 points. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Seconds per kilometre, or null when the distance is too small to be meaningful. */
export function paceSecondsPerKm(seconds: number, meters: number, minMeters = 10): number | null {
  if (!(meters >= minMeters) || !(seconds > 0)) return null;
  return (seconds / meters) * 1000;
}

/** "5:07" for a pace in s/km; "–:––" when unknown. */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm) || secondsPerKm > 3600) return "–:––";
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "1:02:03" or "12:03". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "5.23" km with two decimals. */
export function formatKm(meters: number): string {
  return (Math.max(0, meters) / 1000).toFixed(2);
}
