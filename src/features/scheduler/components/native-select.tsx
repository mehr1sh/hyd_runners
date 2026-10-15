import { cn } from "@/lib/utils";

/**
 * Native select styled like the shared `Input`. Used in dense, repeated form
 * rows (availability, session edits) where a native control is faster to use
 * on phones than a popover select.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
