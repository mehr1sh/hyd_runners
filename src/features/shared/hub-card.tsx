import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/** A section entry on a hub page: what it is and a real figure from the runner's data. */
export function HubCard({
  href,
  title,
  description,
  figure,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  figure: string;
  icon: LucideIcon;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-brand-navy focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-2 font-semibold text-brand-navy">
          <Icon className="size-4 text-brand-red" aria-hidden /> {title}
        </span>
        <span className="text-sm text-muted-foreground">{description}</span>
        <span className="mt-auto text-sm font-medium text-brand-navy">{figure}</span>
      </Link>
    </li>
  );
}
