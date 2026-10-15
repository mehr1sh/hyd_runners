import type { WorkoutBlock } from "@/lib/contracts";

const KIND_LABEL: Record<WorkoutBlock["kind"], string> = {
  warm_up: "Warm-up",
  run: "Run",
  walk: "Walk",
  strength: "Exercise",
  conditioning: "Conditioning",
  rest: "Rest",
  cool_down: "Cool-down",
};

function amount(b: WorkoutBlock) {
  const parts: string[] = [];
  if (b.durationSeconds)
    parts.push(b.durationSeconds >= 120 ? `${Math.round(b.durationSeconds / 60)} min` : `${b.durationSeconds} s`);
  if (b.sets && b.reps) parts.push(`${b.sets} × ${b.reps}`);
  else if (b.sets) parts.push(`${b.sets} sets`);
  if (b.repeat > 1) parts.push(`× ${b.repeat}`);
  return parts.join(" · ");
}

const same = (a: WorkoutBlock, b: WorkoutBlock) =>
  a.kind === b.kind &&
  a.durationSeconds === b.durationSeconds &&
  a.sets === b.sets &&
  a.reps === b.reps &&
  a.notes === b.notes;

/** Collapse an exactly repeating run of blocks (e.g. run 60 s / walk 90 s × 8) into one group. */
export function compactBlocks(blocks: WorkoutBlock[]): { blocks: WorkoutBlock[]; times: number }[] {
  const out: { blocks: WorkoutBlock[]; times: number }[] = [];
  let i = 0;
  while (i < blocks.length) {
    let best = { size: 1, times: 1 };
    for (let size = 1; size <= 4 && i + size * 2 <= blocks.length; size++) {
      let times = 1;
      while (
        i + (times + 1) * size <= blocks.length &&
        blocks.slice(i, i + size).every((b, k) => same(b, blocks[i + times * size + k]))
      )
        times++;
      if (times > 1 && times * size > best.times * best.size) best = { size, times };
    }
    out.push({ blocks: blocks.slice(i, i + best.size), times: best.times });
    i += best.size * best.times;
  }
  return out;
}

function Row({ b }: { b: WorkoutBlock }) {
  return (
    <li className="flex items-start justify-between gap-4 px-3 py-2">
      <span className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1.5 size-2 shrink-0 rounded-full ${b.kind === "run" ? "bg-brand-red" : b.kind === "walk" ? "bg-brand-navy" : "bg-input"}`}
        />
        <span>
          <span className="font-medium text-brand-navy">{KIND_LABEL[b.kind]}</span>
          {b.notes && <span className="block text-muted-foreground">{b.notes}</span>}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{amount(b)}</span>
    </li>
  );
}

/** Step-by-step session plan from WorkoutBlock data. */
export function SessionBlocks({ blocks }: { blocks: WorkoutBlock[] }) {
  if (!blocks.length) return null;
  return (
    <ol className="divide-y rounded-lg border bg-card text-sm">
      {compactBlocks(blocks).map((g, i) =>
        g.times > 1 ? (
          <li key={i} className="px-3 py-2">
            <span className="text-xs font-semibold tracking-wide text-brand-red-strong uppercase">
              Repeat × {g.times}
            </span>
            <ol className="mt-1 divide-y rounded-md border">
              {g.blocks.map((b, k) => (
                <Row key={k} b={b} />
              ))}
            </ol>
          </li>
        ) : (
          <Row key={i} b={g.blocks[0]} />
        ),
      )}
    </ol>
  );
}
