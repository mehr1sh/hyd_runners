"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export type ErrorBoundaryProps = { error: Error & { digest?: string }; retry: () => void };

/**
 * Fallback for route error boundaries. `landmark` renders it as the page's
 * <main>; inside the app shell (which already has <main>) it is a plain block.
 */
export function ErrorFallback({ error, retry, landmark = false }: ErrorBoundaryProps & { landmark?: boolean }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const Wrapper = landmark ? "main" : "div";
  return (
    <Wrapper
      role={landmark ? undefined : "alert"}
      className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="text-2xl font-semibold text-brand-navy">Something went wrong</h1>
      <p className="text-muted-foreground">
        We could not load this page. Try again, and if it keeps happening let a coach know.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      {/* retry() re-fetches the server segment; reset() would only re-render the cached error. */}
      <Button onClick={() => retry()}>Try again</Button>
    </Wrapper>
  );
}
