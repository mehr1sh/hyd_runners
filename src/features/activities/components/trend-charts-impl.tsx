"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPace } from "@/features/events/logic";

const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;
const tooltip = { contentStyle: { borderRadius: 8, border: "1px solid var(--border)", color: "var(--brand-navy)" } };

export type WeekPoint = { weekStart: string; distanceKm: number; avgPace: number | null };

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default function TrendCharts({ data }: { data: WeekPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: short(d.weekStart) }));
  const paced = rows.filter((r) => r.avgPace !== null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <figure className="space-y-2">
        <figcaption className="text-sm font-medium text-brand-navy">Running distance per week (km)</figcaption>
        <div
          className="h-56 w-full"
          role="img"
          aria-label={`Weekly running distance: ${rows.map((r) => `week of ${r.label} ${r.distanceKm} km`).join(", ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip {...tooltip} formatter={(v) => [`${v} km`, "Distance"]} />
              <Bar dataKey="distanceKm" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="space-y-2">
        <figcaption className="text-sm font-medium text-brand-navy">
          Average running pace per week (min/km, lower is faster)
        </figcaption>
        <div
          className="h-56 w-full"
          role="img"
          aria-label={`Weekly average pace: ${paced.map((r) => `week of ${r.label} ${formatPace(r.avgPace!)} per km`).join(", ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={paced} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" {...axis} />
              <YAxis
                {...axis}
                reversed
                domain={["dataMin - 15", "dataMax + 15"]}
                tickFormatter={(v) => formatPace(Math.round(v))}
              />
              <Tooltip {...tooltip} formatter={(v) => [`${formatPace(Number(v))} /km`, "Pace"]} />
              <Line type="monotone" dataKey="avgPace" stroke="var(--brand-red)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
