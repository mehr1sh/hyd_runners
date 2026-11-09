/**
 * A route drawn as a line, scaled to fit. Pass only coordinates the viewer may
 * see (the privacy-trimmed public path for others).
 */
export function RoutePreview({
  coordinates,
  className = "h-16 w-24",
  label = "Route preview",
  stroke = "currentColor",
}: {
  coordinates: [number, number][] | null;
  className?: string;
  label?: string;
  stroke?: string;
}) {
  if (!coordinates || coordinates.length < 2) return null;
  const lats = coordinates.map((c) => c[1]);
  const lons = coordinates.map((c) => c[0]);
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const xs = lons.map((l) => l * Math.cos(midLat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = 6;
  const size = 100;
  const scale = (size - pad * 2) / span;
  const ox = (size - (maxX - minX) * scale) / 2;
  const oy = (size - (maxY - minY) * scale) / 2;
  const d = coordinates
    .map(
      (_, i) =>
        `${i ? "L" : "M"}${(ox + (xs[i] - minX) * scale).toFixed(1)},${(size - oy - (lats[i] - minY) * scale).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label={label}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
