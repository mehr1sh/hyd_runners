"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { reportContentAction, type FormState } from "../actions";
import { REPORT_REASON_LABEL, type ReportTarget } from "../logic/moderation";

const idle: FormState = { status: "idle" };
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** A collapsed "Report" control for one message, reply or feedback item. */
export function ReportForm({
  targetType,
  targetId,
  alreadyReported,
}: {
  targetType: ReportTarget;
  targetId: string;
  alreadyReported: boolean;
}) {
  const [state, action, pending] = useActionState(reportContentAction, idle);
  if (alreadyReported || state.status === "success") {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {state.status === "success" ? state.message : "You reported this. A moderator will review it."}
      </p>
    );
  }
  const id = `report-${targetId}`;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">Report</summary>
      <form action={action} className="mt-2 grid gap-2 rounded-lg border p-3">
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <label className="grid gap-1" htmlFor={`${id}-reason`}>
          Reason
          <select id={`${id}-reason`} name="reason" required defaultValue="" className={selectClass}>
            <option value="" disabled>
              Choose a reason
            </option>
            {Object.entries(REPORT_REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1" htmlFor={`${id}-details`}>
          Details (optional)
          <textarea
            id={`${id}-details`}
            name="details"
            maxLength={1000}
            rows={2}
            className="rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        </label>
        <p className="text-muted-foreground">
          A moderator will see this item and your report. Nothing else from your conversations is shared.
        </p>
        {state.status === "error" && (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </Button>
      </form>
    </details>
  );
}
