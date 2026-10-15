"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Share an achievement as text plus a link to HYD Runners. Nothing private is
 * included: no exact location, no profile link, no workout id.
 */
export function ShareButtons({ text, url }: { text: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const message = `${text} ${url}`;
  // false during server render, real value after hydration (no mismatch).
  const canNativeShare = useSyncExternalStore(
    () => () => {},
    () => "share" in navigator,
    () => false,
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on X
        </a>
      </Button>
      {canNativeShare && (
        <Button size="sm" variant="outline" onClick={() => navigator.share({ text, url }).catch(() => undefined)}>
          <Share2 aria-hidden /> More
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await navigator.clipboard.writeText(message);
          setCopied(true);
        }}
      >
        <Copy aria-hidden /> {copied ? "Copied" : "Copy text"}
      </Button>
    </div>
  );
}
