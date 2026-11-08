"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteLine } from "./route-leaflet";

export type { RouteLine };

// Leaflet touches `window`, so it loads in the browser only.
const RouteLeaflet = dynamic(() => import("./route-leaflet"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export function RouteMap({
  lines,
  label,
  className = "h-[380px]",
}: {
  lines: RouteLine[];
  label: string;
  className?: string;
}) {
  return (
    <div className={`isolate overflow-hidden rounded-xl border bg-card ${className}`} role="region" aria-label={label}>
      <RouteLeaflet lines={lines} />
    </div>
  );
}
