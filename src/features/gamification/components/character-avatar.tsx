import { cn } from "@/lib/utils";

/**
 * The runner's character. Each stage adds a visible element that matches the
 * milestone that unlocked it (shoes for the first workout, motion for a
 * habit, a medal for a finished programme) — no decorative animation.
 */
export function CharacterAvatar({ stage, className }: { stage: number; className?: string }) {
  const navy = "var(--brand-navy)";
  const red = "var(--brand-red)";
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label={`Character stage ${stage} of 5`}
      className={cn("size-20", className)}
    >
      <circle cx="48" cy="48" r="46" fill="var(--brand-navy-soft)" />
      {/* Stage 1: a spark */}
      {stage === 1 && <path d="M48 26l5 14 14 2-11 9 4 15-12-8-12 8 4-15-11-9 14-2z" fill={red} />}
      {stage >= 2 && (
        <g>
          <circle cx="50" cy="26" r="7" fill={navy} />
          {/* torso and arms */}
          <path d="M50 34l-4 20" stroke={navy} strokeWidth="5" strokeLinecap="round" />
          <path
            d={stage >= 3 ? "M48 40l12 6M48 40l-12 4" : "M48 40l8 8M48 40l-8 8"}
            stroke={navy}
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* legs: standing at stage 2, striding from stage 3 */}
          <path
            d={stage >= 3 ? "M46 54l-10 14M46 54l12 8 -2 12" : "M46 54l-4 18M46 54l4 18"}
            stroke={navy}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Stage 2 milestone: running shoes */}
          <rect x={stage >= 3 ? 30 : 37} y={stage >= 3 ? 66 : 70} width="10" height="5" rx="2" fill={red} />
          <rect x={stage >= 3 ? 52 : 47} y={stage >= 3 ? 73 : 70} width="10" height="5" rx="2" fill={red} />
        </g>
      )}
      {/* Stage 3: motion lines for a steady habit */}
      {stage >= 3 && <path d="M18 40h10M14 50h12M18 60h8" stroke={red} strokeWidth="3" strokeLinecap="round" />}
      {/* Stage 4: a race bib for 20+ minutes of running */}
      {stage >= 4 && <rect x="43" y="40" width="10" height="9" rx="1.5" fill="#fff" stroke={red} strokeWidth="1.5" />}
      {/* Stage 5: a finisher's medal */}
      {stage >= 5 && (
        <g>
          <path d="M66 18l4 10M78 18l-4 10" stroke={navy} strokeWidth="3" />
          <circle cx="72" cy="32" r="6" fill={red} />
        </g>
      )}
    </svg>
  );
}
