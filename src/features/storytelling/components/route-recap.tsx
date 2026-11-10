"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Split = { index: number; seconds: number };

/**
 * Animated recap: the real route draws itself while distance and time count
 * up to the real totals, with a marker at each kilometre from the recorded
 * splits. Nothing is interpolated beyond the recorded data. Honours
 * prefers-reduced-motion by showing the final frame.
 */
export function RouteRecap({
  coordinates,
  distanceM,
  movingSeconds,
  splits,
}: {
  coordinates: [number, number][];
  distanceM: number;
  movingSeconds: number;
  splits: Split[];
}) {
  const W = 320;
  const H = 240;
  const { d, length, kmMarks } = useMemo(() => {
    const lons = coordinates.map((c) => c[0]);
    const lats = coordinates.map((c) => c[1]);
    const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const k = Math.min((W - 24) / Math.max(1e-9, x1 - x0), (H - 24) / Math.max(1e-9, y1 - y0));
    const pts = coordinates.map(([lon, lat]) => [12 + (lon - x0) * k, H - 12 - (lat - y0) * k] as [number, number]);
    let len = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(len);
    }
    const marks = splits
      .filter((s) => s.index * 1000 < distanceM)
      .map((s) => {
        const target = (s.index * 1000 * len) / distanceM;
        const i = cum.findIndex((c) => c >= target);
        return { km: s.index, at: pts[Math.max(0, i)], frac: target / Math.max(1, len) };
      });
    return { d: `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L")}`, length: len, kmMarks: marks };
  }, [coordinates, splits, distanceM]);

  const [progress, setProgress] = useState(1);
  const frame = useRef<number | null>(null);

  function play() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }
    const start = performance.now();
    const duration = 6000;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
  }
  useEffect(() => () => void (frame.current && cancelAnimationFrame(frame.current)), []);

  const km = ((distanceM * progress) / 1000).toFixed(2);
  const secs = Math.round(movingSeconds * progress);
  const time = `${Math.floor(secs / 3600) ? `${Math.floor(secs / 3600)}:` : ""}${String(Math.floor((secs % 3600) / 60)).padStart(Math.floor(secs / 3600) ? 2 : 1, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-md rounded-xl bg-[#0b0f1a]"
        role="img"
        aria-label="Animated route recap"
      >
        <path
          d={d}
          fill="none"
          stroke="#39ff88"
          strokeOpacity={0.15}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={d}
          fill="none"
          stroke="#39ff88"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - progress)}
        />
        {kmMarks
          .filter((m) => m.frac <= progress)
          .map((m) => (
            <g key={m.km}>
              <circle cx={m.at[0]} cy={m.at[1]} r={4} fill="#ffffff" />
              <text x={m.at[0] + 6} y={m.at[1] - 6} fontSize={10} fill="#ffffff">
                {m.km} km
              </text>
            </g>
          ))}
        <text x={12} y={22} fontSize={16} fontWeight={700} fill="#ffffff">
          {km} km
        </text>
        <text x={12} y={40} fontSize={12} fill="#c8cdda">
          {time}
        </text>
      </svg>
      <figcaption className="flex items-center gap-3 text-xs text-muted-foreground">
        <Button type="button" size="sm" variant="outline" onClick={play}>
          {progress < 1 ? "Playing…" : "Play recap"}
        </Button>
        Drawn from the shared route; kilometre markers come from your splits.
      </figcaption>
    </figure>
  );
}
