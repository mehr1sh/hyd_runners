"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clock,
  distanceFor,
  intervalTargets,
  kmh,
  paceFrom,
  parseClock,
  perMile,
  raceSplits,
  timeFor,
} from "../logic/pace";

const PRESETS = [
  { label: "5K", m: 5000 },
  { label: "10K", m: 10000 },
  { label: "Half marathon", m: 21097.5 },
  { label: "Marathon", m: 42195 },
];
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function PaceCalculator() {
  const [mode, setMode] = useState<"pace" | "time" | "distance">("pace");
  const [distance, setDistance] = useState("10");
  const [time, setTime] = useState("55:00");
  const [pace, setPace] = useState("5:30");
  const [neg, setNeg] = useState("0");
  const [reps, setReps] = useState("400, 800, 1000");

  const km = Number(distance);
  const t = parseClock(time);
  const p = parseClock(pace);
  const meters = Number.isFinite(km) && km > 0 && km <= 500 ? km * 1000 : null;

  const result = useMemo(() => {
    if (mode === "pace" && meters && t) return { pace: paceFrom(t, meters), time: t, meters };
    if (mode === "time" && meters && p) return { pace: p, time: timeFor(p, meters), meters };
    if (mode === "distance" && p && t) return { pace: p, time: t, meters: distanceFor(p, t) };
    return null;
  }, [mode, meters, t, p]);

  const negPct = Math.min(10, Math.max(0, Number(neg) || 0));
  const splits = result && result.meters <= 100_000 ? raceSplits(result.time, result.meters, 1000, negPct) : [];
  const repMeters = reps
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 10000)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3 rounded-xl border bg-card p-4">
        <legend className="px-1 font-semibold">Calculate</legend>
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="What to calculate">
          {(["pace", "time", "distance"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              {m === "pace" ? "Pace" : m === "time" ? "Finish time" : "Distance"}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {mode !== "distance" && (
            <div className="space-y-1">
              <Label htmlFor="pc-distance">Distance (km)</Label>
              <Input
                id="pc-distance"
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((x) => (
                  <button
                    key={x.label}
                    type="button"
                    className="rounded border px-1.5 text-xs hover:bg-muted"
                    onClick={() => setDistance(String(x.m / 1000))}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode !== "time" && (
            <div className="space-y-1">
              <Label htmlFor="pc-time">Time (h:mm:ss or mm:ss)</Label>
              <Input id="pc-time" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={t === null} />
            </div>
          )}
          {mode !== "pace" && (
            <div className="space-y-1">
              <Label htmlFor="pc-pace">Pace (min:ss per km)</Label>
              <Input id="pc-pace" value={pace} onChange={(e) => setPace(e.target.value)} aria-invalid={p === null} />
            </div>
          )}
        </div>
        <div aria-live="polite" className="text-sm">
          {result ? (
            <p>
              <strong>{(result.meters / 1000).toFixed(2)} km</strong> in <strong>{clock(result.time)}</strong> at{" "}
              <strong>{clock(result.pace)} /km</strong> ({clock(perMile(result.pace))} /mile,{" "}
              {kmh(result.pace).toFixed(1)} km/h)
            </p>
          ) : (
            <p className="text-muted-foreground">Enter valid values to see the result.</p>
          )}
        </div>
      </fieldset>

      {result && splits.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="splits-h">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="splits-h" className="font-semibold">
              Race pacing plan
            </h2>
            <div className="space-y-1">
              <Label htmlFor="pc-neg">Negative split (second half faster, %)</Label>
              <select id="pc-neg" className={selectClass} value={neg} onChange={(e) => setNeg(e.target.value)}>
                {["0", "1", "2", "3", "5"].map((v) => (
                  <option key={v} value={v}>
                    {v === "0" ? "Even pace" : `${v}%`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Km</th>
                  <th>Split</th>
                  <th>Pace</th>
                  <th>Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s) => (
                  <tr key={s.index} className="border-t">
                    <td className="py-1">{s.meters < 999 ? `${s.index} (${Math.round(s.meters)} m)` : s.index}</td>
                    <td>{clock(s.splitSeconds)}</td>
                    <td>{clock(s.paceS)}</td>
                    <td>{clock(s.elapsedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            GPS watches often read a little long or short; use splits as a guide.
          </p>
        </section>
      )}

      {result && (
        <section className="space-y-2 rounded-xl border bg-card p-4" aria-labelledby="int-h">
          <h2 id="int-h" className="font-semibold">
            Interval targets at {clock(result.pace)} /km
          </h2>
          <Label htmlFor="pc-reps">Rep distances in metres</Label>
          <Input id="pc-reps" value={reps} onChange={(e) => setReps(e.target.value)} />
          <ul className="text-sm">
            {intervalTargets(result.pace, repMeters).map((r) => (
              <li key={r.meters}>
                {r.meters} m: {clock(r.seconds)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
