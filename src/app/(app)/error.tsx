"use client";

import { ErrorFallback, type ErrorBoundaryProps } from "@/components/shared/error-fallback";

/**
 * Error boundary for signed-in pages. It sits inside the (app) layout, so the
 * header, navigation and sign-out stay usable when a page fails to render.
 */
export default function AppErrorPage(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} />;
}
