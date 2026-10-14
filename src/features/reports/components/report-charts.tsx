"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;
const tooltip = { contentStyle: { borderRadius: 8, border: "1px solid var(--border)", color: "var(--brand-navy)" } };

function Frame({ label, summary, children }: { label: string; summary: string; children: React.ReactElement }) {
  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="h-52 w-full" role="img" aria-label={`${label}: ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ActivityChart({
  data,
  label,
}: {
  data: { label: string; minutes: number; workouts: number }[];
  label: string;
}) {
  return (
    <Frame label={label} summary={data.map((d) => `${d.label} ${d.minutes} minutes`).join(", ")}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={48} allowDecimals={false} />
        <Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} formatter={(v) => [`${v} min`, "Active time"]} />
        <Bar dataKey="minutes" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </Frame>
  );
}

export function ConsistencyChart({ data, label }: { data: { label: string; activeDays: number }[]; label: string }) {
  return (
    <Frame label={label} summary={data.map((d) => `${d.label} ${d.activeDays} active days`).join(", ")}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={48} allowDecimals={false} />
        <Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} formatter={(v) => [v, "Active days"]} />
        <Bar dataKey="activeDays" fill="var(--brand-red)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </Frame>
  );
}

export function StreakChart({ data, label }: { data: { date: string; streak: number }[]; label: string }) {
  const rows = data.map((d) => ({
    label: `${Number(d.date.slice(8))}/${Number(d.date.slice(5, 7))}`,
    streak: d.streak,
  }));
  const max = Math.max(0, ...data.map((d) => d.streak));
  return (
    <Frame label={label} summary={`longest ${max} days in this period`}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...axis} width={48} allowDecimals={false} />
        <Tooltip {...tooltip} formatter={(v) => [`${v} days`, "Habit streak"]} />
        <Line type="stepAfter" dataKey="streak" stroke="var(--brand-red)" strokeWidth={2} dot={false} />
      </LineChart>
    </Frame>
  );
}
