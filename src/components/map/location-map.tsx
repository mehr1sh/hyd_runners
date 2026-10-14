"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { MapPoint } from "./leaflet-map";

export type { MapPoint };

// Leaflet touches `window`, so it must load in the browser only.
const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export function LocationMap({ points, label }: { points: MapPoint[]; label: string }) {
  return (
    <div className="isolate h-[420px] overflow-hidden rounded-xl border bg-card" role="region" aria-label={label}>
      <LeafletMap points={points} />
    </div>
  );
}
