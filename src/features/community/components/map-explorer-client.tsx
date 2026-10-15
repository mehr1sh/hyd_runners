"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExplorerLocation } from "./map-explorer";

// Leaflet needs `window`: load it in the browser only.
const MapExplorer = dynamic(() => import("./map-explorer"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export function MapExplorerClient({
  locations,
  selectedId,
}: {
  locations: ExplorerLocation[];
  selectedId: string | null;
}) {
  return (
    <div
      className="isolate h-[420px] overflow-hidden rounded-xl border bg-card"
      role="region"
      aria-label="Map of running places, centred on Hyderabad"
    >
      <MapExplorer locations={locations} selectedId={selectedId} />
    </div>
  );
}
