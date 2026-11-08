/** A small SVG elevation profile. Rendered only when the route has real elevation data. */
export function ElevationProfile({ profile }: { profile: [number, number][] }) {
  if (profile.length < 2) return null;
  const maxD = profile[profile.length - 1][0] || 1;
  const eles = profile.map((p) => p[1]);
  const minE = Math.min(...eles);
  const maxE = Math.max(...eles);
  const span = Math.max(maxE - minE, 5);
  const w = 600;
  const h = 120;
  const d = profile
    .map(
      ([dist, ele], i) =>
        `${i === 0 ? "M" : "L"}${((dist / maxD) * w).toFixed(1)},${(h - ((ele - minE) / span) * (h - 10) - 5).toFixed(1)}`,
    )
    .join(" ");
  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Elevation from ${Math.round(minE)} m to ${Math.round(maxE)} m`}
      >
        <path d={`${d} L${w},${h} L0,${h} Z`} className="fill-brand-navy-soft" />
        <path d={d} fill="none" className="stroke-brand-navy" strokeWidth={2} />
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        Elevation {Math.round(minE)}–{Math.round(maxE)} m, from the uploaded GPX track.
      </figcaption>
    </figure>
  );
}
