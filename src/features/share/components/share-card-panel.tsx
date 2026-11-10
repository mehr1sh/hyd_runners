"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CARD_FORMATS, CARD_THEMES, cardQuery, type CardFormat, type CardTheme } from "../logic";

/**
 * Preview, download and (where the browser supports sharing files) share a
 * card. Cards are rendered by the server for the signed-in owner only.
 */
export function ShareCardPanel({
  endpoint,
  filename,
  canHideRoute,
  canHidePace,
  themes = false,
}: {
  endpoint: string;
  filename: string;
  canHideRoute: boolean;
  canHidePace: boolean;
  /** Poster themes are offered for activity cards. */
  themes?: boolean;
}) {
  const [format, setFormat] = useState<CardFormat>("square");
  const [showRoute, setShowRoute] = useState(true);
  const [showPace, setShowPace] = useState(true);
  const [theme, setTheme] = useState<CardTheme>("classic");
  const [status, setStatus] = useState<string | null>(null);
  const src = `${endpoint}?${cardQuery({ format, showRoute, showPace, theme })}`;
  const { width, height } = CARD_FORMATS[format];

  async function share() {
    setStatus(null);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], `${filename}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        setStatus("This browser can’t share images directly. Download the card instead.");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setStatus("Could not share the card. Try downloading it.");
    }
  }

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated, private PNG */}
      <img
        src={src}
        width={width}
        height={height}
        alt="Preview of your share card"
        className="h-auto w-full max-w-xs rounded-lg border bg-muted"
      />
      <div className="space-y-3">
        <div className="grid gap-1">
          <Label htmlFor="card-format">Format</Label>
          <select
            id="card-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as CardFormat)}
            className="h-9 max-w-xs rounded-md border bg-background px-2 text-sm"
          >
            {(Object.keys(CARD_FORMATS) as CardFormat[]).map((f) => (
              <option key={f} value={f}>
                {CARD_FORMATS[f].label}
              </option>
            ))}
          </select>
        </div>
        {themes && (
          <div className="grid gap-1">
            <Label htmlFor="card-theme">Style</Label>
            <select
              id="card-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as CardTheme)}
              className="h-9 max-w-xs rounded-md border bg-background px-2 text-sm"
            >
              {(Object.keys(CARD_THEMES) as CardTheme[]).map((t) => (
                <option key={t} value={t}>
                  {CARD_THEMES[t]}
                </option>
              ))}
            </select>
          </div>
        )}
        {canHideRoute && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
            Show the route shape (privacy-trimmed)
          </label>
        )}
        {canHidePace && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPace} onChange={(e) => setShowPace(e.target.checked)} />
            Show pace
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={src} download={`${filename}.png`}>
              <Download className="size-4" aria-hidden /> Download card
            </a>
          </Button>
          <Button type="button" variant="outline" onClick={share}>
            <Share2 className="size-4" aria-hidden /> Share
          </Button>
        </div>
        {status && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Cards show the date but not the time, never show heart rate, and draw only the privacy-trimmed route.
        </p>
      </div>
    </div>
  );
}
