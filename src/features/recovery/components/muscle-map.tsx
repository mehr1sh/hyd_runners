import { MUSCLE_LABEL, MUSCLES, type Muscle } from "@/features/training/logic/strength-templates";
import { shade } from "../logic/muscles";

/** Region shapes on a simple front and back outline (viewBox 0 0 240 230). */
const FRONT: Partial<Record<Muscle, { cx: number; cy: number; rx: number; ry: number }[]>> = {
  shoulders: [
    { cx: 32, cy: 52, rx: 9, ry: 7 },
    { cx: 88, cy: 52, rx: 9, ry: 7 },
  ],
  chest: [{ cx: 60, cy: 60, rx: 20, ry: 9 }],
  core: [{ cx: 60, cy: 88, rx: 11, ry: 17 }],
  obliques: [
    { cx: 44, cy: 90, rx: 5, ry: 13 },
    { cx: 76, cy: 90, rx: 5, ry: 13 },
  ],
  hip_flexors: [
    { cx: 50, cy: 113, rx: 7, ry: 6 },
    { cx: 70, cy: 113, rx: 7, ry: 6 },
  ],
  adductors: [
    { cx: 54, cy: 135, rx: 4, ry: 12 },
    { cx: 66, cy: 135, rx: 4, ry: 12 },
  ],
  quads: [
    { cx: 46, cy: 140, rx: 8, ry: 20 },
    { cx: 74, cy: 140, rx: 8, ry: 20 },
  ],
};
const BACK: Partial<Record<Muscle, { cx: number; cy: number; rx: number; ry: number }[]>> = {
  shoulders: [
    { cx: 152, cy: 52, rx: 9, ry: 7 },
    { cx: 208, cy: 52, rx: 9, ry: 7 },
  ],
  upper_back: [{ cx: 180, cy: 64, rx: 20, ry: 12 }],
  lower_back: [{ cx: 180, cy: 94, rx: 11, ry: 10 }],
  hip_abductors: [
    { cx: 161, cy: 110, rx: 5, ry: 7 },
    { cx: 199, cy: 110, rx: 5, ry: 7 },
  ],
  glutes: [
    { cx: 171, cy: 116, rx: 9, ry: 9 },
    { cx: 189, cy: 116, rx: 9, ry: 9 },
  ],
  hamstrings: [
    { cx: 168, cy: 145, rx: 8, ry: 18 },
    { cx: 192, cy: 145, rx: 8, ry: 18 },
  ],
  calves: [
    { cx: 168, cy: 185, rx: 6, ry: 14 },
    { cx: 192, cy: 185, rx: 6, ry: 14 },
  ],
};
const FILL = [
  "transparent",
  "color-mix(in oklab, var(--success) 30%, transparent)",
  "color-mix(in oklab, var(--success) 60%, transparent)",
  "var(--success)",
];

function Outline({ x }: { x: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5">
      <circle cx={x + 60} cy={22} r={12} />
      <path
        d={`M${x + 36} 44 Q${x + 60} 38 ${x + 84} 44 L${x + 96} 100 L${x + 88} 102 L${x + 80} 66 L${x + 78} 110 L${x + 84} 200 L${x + 72} 214 L${x + 62} 120 L${x + 58} 120 L${x + 48} 214 L${x + 36} 200 L${x + 42} 110 L${x + 40} 66 L${x + 32} 102 L${x + 24} 100 Z`}
      />
    </g>
  );
}

export function MuscleMap({ load, days }: { load: Record<Muscle, number>; days: number }) {
  const worked = MUSCLES.filter((m) => load[m] > 0).sort((a, b) => load[b] - load[a]);
  const regions = (map: typeof FRONT) =>
    Object.entries(map).flatMap(([m, shapes]) =>
      shapes!.map((s, i) => (
        <ellipse
          key={`${m}${i}`}
          {...s}
          fill={FILL[shade(load[m as Muscle])]}
          stroke="currentColor"
          strokeOpacity="0.2"
        >
          <title>{`${MUSCLE_LABEL[m as Muscle]}: ${load[m as Muscle] ? `${load[m as Muscle]} set-equivalents` : "not worked"}`}</title>
        </ellipse>
      )),
    );
  return (
    <figure className="space-y-2">
      <svg
        viewBox="0 0 240 230"
        className="mx-auto h-64 w-auto text-brand-navy"
        role="img"
        aria-label={`Muscles worked by logged strength sessions in the last ${days} days`}
      >
        <Outline x={0} />
        <Outline x={120} />
        {regions(FRONT)}
        {regions(BACK)}
        <text x={60} y={228} textAnchor="middle" fontSize="10" fill="currentColor">
          Front
        </text>
        <text x={180} y={228} textAnchor="middle" fontSize="10" fill="currentColor">
          Back
        </text>
      </svg>
      <figcaption className="text-sm">
        {worked.length === 0 ? (
          <span className="text-muted-foreground">No strength sessions logged in the last {days} days.</span>
        ) : (
          <>
            <span className="font-medium">Worked in the last {days} days: </span>
            {worked.map((m) => `${MUSCLE_LABEL[m]} (${load[m]})`).join(", ")}
            <span className="block text-xs text-muted-foreground">
              Set-equivalents from the exercises you logged: a set counts fully for the main muscles and half for
              supporting ones.
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
