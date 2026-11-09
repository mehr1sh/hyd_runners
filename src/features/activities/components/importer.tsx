"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callApi, uploadWithProgress } from "@/features/scheduler/components/api-client";
import { ACTIVITY_TYPE_LABEL, VISIBILITY_LABEL } from "../logic/format";

type Step =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing" }
  | { kind: "error"; message: string; activityId?: string; retryable?: boolean }
  | { kind: "duplicate"; duplicateOf: string };

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type ProcessResult =
  | { status: "ready"; activityId: string }
  | { status: "duplicate"; activityId: string; duplicateOf: string }
  | { status: "failed"; activityId: string; reason: string; retryable: boolean }
  | { status: "processing"; activityId: string };

export function ActivityImporter() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  async function process(activityId: string) {
    setStep({ kind: "processing" });
    const r = await callApi<ProcessResult>(`/api/v1/activities/${activityId}/process`, { method: "POST" });
    if (!r.ok) return setStep({ kind: "error", message: r.error.message, activityId, retryable: true });
    const out = r.data;
    if (out.status === "ready") return router.push(`/activities/${out.activityId}`);
    if (out.status === "duplicate") return setStep({ kind: "duplicate", duplicateOf: out.duplicateOf });
    if (out.status === "processing")
      return setStep({
        kind: "error",
        message: "Still processing. Try again in a moment.",
        activityId,
        retryable: true,
      });
    setStep({ kind: "error", message: out.reason, activityId, retryable: out.retryable });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      return setStep({ kind: "error", message: "Choose a GPX or FIT file." });
    if (file.size > 15 * 1024 * 1024)
      return setStep({ kind: "error", message: "Activity files must be 15 MB or smaller." });
    setStep({ kind: "uploading", percent: 0 });
    const r = await callApi<{ activityId: string; uploadUrl: string }>("/api/v1/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sizeBytes: file.size,
        activityType: form.get("activityType"),
        visibility: form.get("visibility"),
        name: String(form.get("name") ?? "") || null,
      }),
    });
    if (!r.ok) return setStep({ kind: "error", message: r.error.message });
    try {
      await uploadWithProgress(r.data.uploadUrl, file, (percent) => setStep({ kind: "uploading", percent }));
    } catch {
      return setStep({ kind: "error", message: "The upload failed. Check your connection and try again." });
    }
    await process(r.data.activityId);
  }

  const busy = step.kind === "uploading" || step.kind === "processing";
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="grid gap-1 text-sm">
        <label htmlFor="activity-file">GPX or FIT file (up to 15 MB)</label>
        <input
          id="activity-file"
          name="file"
          type="file"
          accept=".gpx,.fit,application/gpx+xml,application/octet-stream"
          required
          className="text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1 text-sm">
          <label htmlFor="activity-type">Activity</label>
          <select id="activity-type" name="activityType" defaultValue="run" className={selectClass}>
            {Object.entries(ACTIVITY_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor="activity-visibility">Who can see it</label>
          <select id="activity-visibility" name="visibility" defaultValue="private" className={selectClass}>
            {Object.entries(VISIBILITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1 text-sm">
        <label htmlFor="activity-name">Name (optional)</label>
        <input
          id="activity-name"
          name="name"
          maxLength={120}
          className="h-9 rounded-lg border border-input px-2.5 text-sm"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        We calculate distance, pace, splits and elevation from the file itself. Others never see your exact start and
        end points or your GPS samples. If you already logged this run by hand, it is linked rather than counted twice.
      </p>
      <Button type="submit" disabled={busy}>
        {step.kind === "uploading"
          ? `Uploading… ${step.percent}%`
          : step.kind === "processing"
            ? "Processing…"
            : "Import activity"}
      </Button>
      <div aria-live="polite" className="text-sm">
        {step.kind === "error" && (
          <div role="alert" className="space-y-2 text-destructive">
            <p>{step.message}</p>
            {step.activityId && step.retryable && (
              <Button type="button" size="sm" variant="outline" onClick={() => process(step.activityId!)}>
                Try processing again
              </Button>
            )}
          </div>
        )}
        {step.kind === "duplicate" && (
          <p role="alert">
            You have already imported this activity.{" "}
            <a href={`/activities/${step.duplicateOf}`} className="underline underline-offset-4">
              Open it
            </a>
          </p>
        )}
      </div>
    </form>
  );
}
