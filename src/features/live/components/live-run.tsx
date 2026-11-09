"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { endLiveSession, requestHelp, resolveHelp, startLiveSession, startSharing, stopSharing } from "../actions";
import { ageLabel, freshness, MAX_ACCURACY_M, POLL_INTERVAL_MS, SEND_INTERVAL_MS } from "../logic";
import type { LiveState } from "../queries";

const LiveLeaflet = dynamic(() => import("./live-leaflet"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const FRESH_LABEL = { live: "Live", stale: "Stale", lost: "Signal lost" } as const;

export function LiveRun({ eventId, userId, initial }: { eventId: string; userId: string; initial: LiveState }) {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [gps, setGps] = useState<{
    status: "idle" | "waiting" | "ok" | "denied" | "error" | "inaccurate";
    accuracy?: number;
    sentAt?: number;
  }>({ status: "idle" });
  const [minutes, setMinutes] = useState(90);
  const [helpText, setHelpText] = useState("");
  const lastSent = useRef(0);
  const lastFix = useRef<{ lat: number; lon: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/live/${eventId}`, { cache: "no-store" });
      if (res.ok) setState(((await res.json()) as { data: LiveState }).data);
    } catch {
      // Offline: keep the last state; freshness labels show it is ageing.
    }
    setNow(Date.now());
  }, [eventId]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [refresh]);

  const sessionLive = Boolean(state.session && !state.session.endedAt && Date.parse(state.session.endsAt) > now);
  const sharing = Boolean(
    sessionLive && state.myShare && !state.myShare.stoppedAt && Date.parse(state.myShare.expiresAt) > now,
  );

  // Watch position only while this runner is actively sharing.
  useEffect(() => {
    if (!sharing || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      async (pos) => {
        const acc = pos.coords.accuracy;
        lastFix.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (acc > MAX_ACCURACY_M) {
          setGps({ status: "inaccurate", accuracy: acc });
          return;
        }
        if (Date.now() - lastSent.current < SEND_INTERVAL_MS) {
          setGps((g) => ({ ...g, status: "ok", accuracy: acc }));
          return;
        }
        lastSent.current = Date.now();
        try {
          const res = await fetch(`/api/v1/live/${eventId}/position`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: acc,
              recordedAt: new Date(pos.timestamp).toISOString(),
            }),
          });
          const body = (await res.json()) as { data?: { status: string } };
          if (body.data?.status === "not_sharing") void refresh();
          setGps({ status: "ok", accuracy: acc, sentAt: Date.now() });
        } catch {
          setGps({ status: "error", accuracy: acc });
        }
      },
      (err) => setGps({ status: err.code === err.PERMISSION_DENIED ? "denied" : "error" }),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [sharing, eventId, refresh]);

  async function run(p: Promise<{ ok: boolean; message?: string }>) {
    const r = await p;
    setNote(r.message ?? (r.ok ? null : "Something went wrong."));
    await refresh();
  }

  const myHelp = state.help.filter((h) => h.userId === userId && !h.resolvedAt);
  const openHelp = state.help.filter((h) => !h.resolvedAt);
  const points = state.positions.map((p) => ({
    id: p.userId,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    freshness: freshness(p.recordedAt, now),
    age: ageLabel(p.recordedAt, now),
    help: openHelp.some((h) => h.userId === p.userId),
  }));

  return (
    <div className="space-y-6">
      <p role="note" className="rounded-xl border bg-muted/40 p-3 text-sm">
        Live sharing helps the run&apos;s team keep the group together. It is not an emergency service: in an emergency
        call 112 first.
      </p>
      {note && (
        <p role="status" className="text-sm">
          {note}
        </p>
      )}

      {!state.session ? (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="font-semibold text-brand-navy">Live session not started</h2>
          <p className="text-sm text-muted-foreground">The run&apos;s team opens it up to an hour before the start.</p>
          {state.isStaff && <Button onClick={() => run(startLiveSession(eventId))}>Start live session</Button>}
        </section>
      ) : !sessionLive ? (
        <section className="rounded-xl border bg-card p-4 text-sm">
          The live session has ended and shared positions were deleted.
        </section>
      ) : (
        <>
          {(state.isParticipant || state.isStaff) && (
            <section
              aria-labelledby="share-h"
              className={`space-y-3 rounded-xl border p-4 ${sharing ? "border-success bg-success/10" : "bg-card"}`}
            >
              <h2 id="share-h" className="font-semibold text-brand-navy">
                {sharing ? "You're sharing your location" : "Your location is not shared"}
              </h2>
              {sharing ? (
                <>
                  <p className="text-sm" aria-live="polite">
                    Visible to this run&apos;s organisers, captains and sweepers only, until{" "}
                    {new Date(state.myShare!.expiresAt).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    . {gps.status === "waiting" && "Waiting for GPS…"}
                    {gps.status === "ok" && `GPS accuracy about ${Math.round(gps.accuracy ?? 0)} m.`}
                    {gps.status === "inaccurate" &&
                      `GPS is weak (±${Math.round(gps.accuracy ?? 0)} m), so nothing is sent until it improves.`}
                    {gps.status === "denied" &&
                      "Location permission is blocked in your browser, so nothing is being shared."}
                    {gps.status === "error" && "Couldn't send your position. It will retry."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Keep this page open; browsers stop sharing when the screen locks or you switch apps.
                  </p>
                  <Button variant="destructive" onClick={() => run(stopSharing(eventId))}>
                    Stop sharing now
                  </Button>
                </>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="share-minutes">Share for</Label>
                    <select
                      id="share-minutes"
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    >
                      {[30, 60, 90, 120, 180].map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    onClick={() => {
                      if (!("geolocation" in navigator)) {
                        setNote("This browser can't share its location.");
                        return;
                      }
                      setGps({ status: "waiting" });
                      void run(startSharing(eventId, minutes));
                    }}
                  >
                    Share my location for this run
                  </Button>
                </div>
              )}
            </section>
          )}

          {state.isParticipant && (
            <section aria-labelledby="help-h" className="space-y-2 rounded-xl border bg-card p-4">
              <h2 id="help-h" className="font-semibold text-brand-navy">
                Need help?
              </h2>
              {myHelp.length > 0 ? (
                <div className="space-y-2 text-sm">
                  <p>The team has been notified{sharing ? " and can see your position" : ""}.</p>
                  <Button variant="outline" size="sm" onClick={() => run(resolveHelp(myHelp[0].id))}>
                    I&apos;m OK now
                  </Button>
                </div>
              ) : (
                <>
                  <Label htmlFor="help-note">What&apos;s wrong? (optional)</Label>
                  <Textarea
                    id="help-note"
                    maxLength={300}
                    rows={2}
                    value={helpText}
                    onChange={(e) => setHelpText(e.target.value)}
                  />
                  <Button
                    variant="destructive"
                    onClick={() =>
                      run(requestHelp(eventId, helpText, lastFix.current?.lat ?? null, lastFix.current?.lon ?? null))
                    }
                  >
                    Ask the team for help
                  </Button>
                </>
              )}
            </section>
          )}

          {state.isStaff && (
            <section aria-labelledby="captain-h" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="captain-h" className="font-semibold text-brand-navy">
                  Captain view
                </h2>
                <Button variant="outline" size="sm" onClick={() => run(endLiveSession(eventId))}>
                  End live session
                </Button>
              </div>
              {openHelp.length > 0 && (
                <ul className="space-y-2" aria-label="Help requests">
                  {openHelp.map((h) => (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive bg-brand-red-soft p-3 text-sm"
                    >
                      <span>
                        <span className="font-semibold">{h.name}</span> asked for help {ageLabel(h.createdAt, now)}
                        {h.note ? `: ${h.note}` : ""}
                        {h.lat !== null && h.lon !== null && ` (${h.lat.toFixed(4)}, ${h.lon.toFixed(4)})`}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => run(resolveHelp(h.id))}>
                        Mark resolved
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div
                className="isolate h-[360px] overflow-hidden rounded-xl border"
                role="region"
                aria-label="Shared positions map"
              >
                <LiveLeaflet points={points} />
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">Runners sharing their location</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Runner</th>
                    <th>Status</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {state.shares.map((s) => {
                    const p = state.positions.find((x) => x.userId === s.userId);
                    const active = !s.stoppedAt && Date.parse(s.expiresAt) > now;
                    const f = p ? freshness(p.recordedAt, now) : null;
                    return (
                      <tr key={s.userId} className="border-t">
                        <td className="py-1">{s.name}</td>
                        <td>
                          {!active
                            ? s.stoppedAt
                              ? "Stopped sharing"
                              : "Sharing expired"
                            : f
                              ? FRESH_LABEL[f]
                              : "Waiting for first position"}
                        </td>
                        <td>{p ? ageLabel(p.recordedAt, now) : "—"}</td>
                      </tr>
                    );
                  })}
                  {state.shares.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-muted-foreground">
                        Nobody is sharing yet. Sharing is each runner&apos;s choice.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Positions older than 90 seconds are marked stale and older than 10 minutes as lost. They are never shown
                as current.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
