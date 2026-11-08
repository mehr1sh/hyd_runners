"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveReportAction, viewReportedContentAction, type FormState, type ReportedContentState } from "../actions";
import {
  DECISION_LABEL,
  REPORT_REASON_LABEL,
  REPORT_STATUS_LABEL,
  REPORT_TARGET_LABEL,
  decisionsFor,
} from "../logic/moderation";
import type { ReportSummary } from "../moderation";

const idle: FormState = { status: "idle" };
const closed: ReportedContentState = { status: "idle" };
const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function ModerationQueue({
  open,
  resolved,
  moreOpen,
  viewerId,
}: {
  open: ReportSummary[];
  resolved: ReportSummary[];
  moreOpen: boolean;
  viewerId: string;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Reported items are shown one at a time and only through their report. Every time you open one, it is recorded in
        the audit log. You cannot decide a report you filed or one about you.
      </p>
      {open.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No reports are waiting.</p>
      ) : (
        <ul className="grid gap-3" aria-label="Open reports">
          {open.map((report) => (
            <OpenReport key={report.id} report={report} viewerId={viewerId} />
          ))}
        </ul>
      )}
      {moreOpen && (
        <p className="text-sm text-muted-foreground">More reports are waiting. Resolve these to see the next ones.</p>
      )}
      {resolved.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-brand-navy">Recently resolved</h3>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {resolved.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center gap-2 p-3">
                <Badge variant="outline">{REPORT_STATUS_LABEL[report.status]}</Badge>
                <span>
                  {REPORT_TARGET_LABEL[report.targetType]} by {report.subjectName} ·{" "}
                  {REPORT_REASON_LABEL[report.reason]}
                </span>
                <span className="text-muted-foreground">
                  {report.decision ? DECISION_LABEL[report.decision] : ""}
                  {report.resolvedByName ? ` · ${report.resolvedByName}` : ""}
                  {report.resolutionNote ? ` · “${report.resolutionNote}”` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OpenReport({ report, viewerId }: { report: ReportSummary; viewerId: string }) {
  const [content, view, viewing] = useActionState(viewReportedContentAction, closed);
  const [decision, resolve, resolving] = useActionState(resolveReportAction, idle);
  const involved = report.reporterId === viewerId || report.subjectId === viewerId;
  return (
    <li
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-label={`${REPORT_TARGET_LABEL[report.targetType]} reported for ${REPORT_REASON_LABEL[report.reason]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{REPORT_REASON_LABEL[report.reason]}</Badge>
        <Badge variant="outline">{REPORT_TARGET_LABEL[report.targetType]}</Badge>
      </div>
      <p className="text-sm">
        Reported by {report.reporterName} about {report.subjectName} ·{" "}
        <time dateTime={report.createdAt}>{when.format(new Date(report.createdAt))}</time>
      </p>
      {report.details && <p className="text-sm text-muted-foreground">Reporter&apos;s note: {report.details}</p>}

      {content.status === "ok" ? (
        <blockquote className="rounded-lg border-l-4 border-brand-red bg-muted p-3 text-sm">
          <p className="whitespace-pre-wrap">{content.content.body}</p>
          <footer className="mt-1 text-xs text-muted-foreground">
            {content.content.authorName} · {when.format(new Date(content.content.createdAt))}
            {content.content.hidden ? " · Hidden" : ""}
          </footer>
        </blockquote>
      ) : (
        <form action={view}>
          <input type="hidden" name="reportId" value={report.id} />
          <Button type="submit" variant="outline" size="sm" disabled={viewing}>
            {viewing ? "Opening…" : "Show reported content"}
          </Button>
          {content.status === "error" && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {content.message}
            </p>
          )}
        </form>
      )}

      {involved ? (
        <p className="text-sm text-muted-foreground">Another moderator must decide this report.</p>
      ) : (
        <form action={resolve} className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <input type="hidden" name="reportId" value={report.id} />
          <input type="hidden" name="targetType" value={report.targetType} />
          <label className="grid gap-1 text-xs text-muted-foreground">
            Decision
            <select name="decision" required defaultValue="" className={selectClass}>
              <option value="" disabled>
                Choose
              </option>
              {decisionsFor(report.targetType).map((value) => (
                <option key={value} value={value}>
                  {DECISION_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Note (optional)
            <input name="note" maxLength={1000} className={selectClass} />
          </label>
          <Button type="submit" disabled={resolving}>
            {resolving ? "Saving…" : "Record decision"}
          </Button>
          {decision.message && (
            <Alert
              className="sm:col-span-3"
              variant={decision.status === "error" ? "destructive" : "default"}
              role={decision.status === "error" ? "alert" : "status"}
            >
              <AlertDescription>{decision.message}</AlertDescription>
            </Alert>
          )}
        </form>
      )}
    </li>
  );
}
