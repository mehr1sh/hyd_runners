"use client";

import { ErrorFallback, type ErrorBoundaryProps } from "@/components/shared/error-fallback";

export default function ErrorPage(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} landmark />;
}
