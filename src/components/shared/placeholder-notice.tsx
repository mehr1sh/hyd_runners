import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks an unfinished feature area. Required on every screen that shows
 * layout-only or sample content, so placeholders are never mistaken for real
 * runner activity.
 */
export function PlaceholderNotice({
  feature,
  owner,
  className,
  children,
}: {
  feature: string;
  owner?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-lg border border-dashed border-input bg-card px-4 py-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-brand-navy" aria-hidden />
      <p>
        <span className="font-semibold text-brand-navy">Preview — {feature} is in development.</span>{" "}
        {children ?? "Nothing on this screen is real runner data yet."}
        {owner && <span className="sr-only"> Owner: {owner}.</span>}
      </p>
    </div>
  );
}

/** Small inline label for sample values inside charts or lists. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-input px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      Sample data
    </span>
  );
}
