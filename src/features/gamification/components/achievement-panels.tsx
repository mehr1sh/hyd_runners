import { Award, CheckCircle2, Circle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function ChallengeList({
  challenges,
}: {
  challenges: {
    code: string;
    title: string;
    description: string;
    target: number;
    value: number;
    unit: string;
    done: boolean;
  }[];
}) {
  return (
    <ul className="space-y-3">
      {challenges.map((c) => (
        <li key={c.code} className="space-y-1.5">
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="flex items-start gap-2">
              {c.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Completed" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-input" aria-hidden />
              )}
              <span>
                <span className="font-medium text-brand-navy">{c.title}</span>
                <span className="block text-muted-foreground">{c.description}</span>
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {c.value}/{c.target} {c.unit}
            </span>
          </div>
          <Progress
            className="h-1.5"
            value={(c.value / c.target) * 100}
            aria-label={`${c.title}: ${c.value} of ${c.target} ${c.unit}`}
          />
        </li>
      ))}
    </ul>
  );
}

export function BadgeGrid({
  badges,
  showLocked = true,
}: {
  badges: { code: string; title: string; description: string; earned: boolean }[];
  showLocked?: boolean;
}) {
  const list = showLocked ? badges : badges.filter((b) => b.earned);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((b) => (
        <li
          key={b.code}
          className={cn(
            "flex gap-2 rounded-lg border p-3 text-sm",
            b.earned ? "bg-card" : "border-dashed bg-transparent opacity-80",
          )}
        >
          <Award
            className={cn("mt-0.5 size-4 shrink-0", b.earned ? "text-brand-red" : "text-muted-foreground")}
            aria-hidden
          />
          <span>
            <span className={cn("block font-medium", b.earned ? "text-brand-navy" : "text-muted-foreground")}>
              {b.title}
              <span className="sr-only">{b.earned ? " (earned)" : " (not yet earned)"}</span>
            </span>
            <span className="block text-xs text-muted-foreground">{b.description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
