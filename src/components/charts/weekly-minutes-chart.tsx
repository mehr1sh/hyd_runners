"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type WeeklyMinutesPoint = { label: string; minutes: number };

/** Lightweight bar chart of active minutes per period, using brand tokens. */
export function WeeklyMinutesChart({ data, title }: { data: WeeklyMinutesPoint[]; title: string }) {
  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{title}</figcaption>
      <div
        className="h-56 w-full"
        role="img"
        aria-label={`${title}: ${data.map((d) => `${d.label} ${d.minutes} minutes`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              width={48}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", color: "var(--brand-navy)" }}
              formatter={(value) => [`${value} min`, "Active time"]}
            />
            <Bar dataKey="minutes" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
