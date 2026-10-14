import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Original Hyderabad Runners artwork (910×274). Never recolour or crop it. */
export function Logo({ href = "/", className, priority }: { href?: string; className?: string; priority?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex shrink-0 items-center rounded-md", className)}>
      <Image
        src="/branding/hyd-runners-logo.png"
        alt="Hyderabad Runners — home"
        width={910}
        height={274}
        priority={priority}
        className="h-11 w-auto sm:h-12"
      />
    </Link>
  );
}
