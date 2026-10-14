import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-navy-soft">
        <Icon className="size-5 text-brand-navy" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-brand-navy">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
