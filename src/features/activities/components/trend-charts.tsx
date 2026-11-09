"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { WeekPoint } from "./trend-charts-impl";

// Charts load after the page so the numbers render first.
const Charts = dynamic(() => import("./trend-charts-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

export function TrendCharts({ data }: { data: WeekPoint[] }) {
  return <Charts data={data} />;
}
