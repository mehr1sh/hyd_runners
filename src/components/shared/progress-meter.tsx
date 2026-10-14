import { Progress } from "@/components/ui/progress";

/** Labelled progress bar, e.g. "Sessions this week: 2 of 3". */
export function ProgressMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-brand-navy">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value} of {max}
        </span>
      </div>
      <Progress className="h-2" value={percent} aria-label={`${label}: ${value} of ${max}`} />
    </div>
  );
}
