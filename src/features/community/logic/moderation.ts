import { z } from "zod";

/** Mirrors public.report_reason. */
export const REPORT_REASON_LABEL = {
  harassment: "Harassment or bullying",
  spam: "Spam",
  inappropriate: "Inappropriate content",
  safety: "Safety concern",
  other: "Something else",
} as const;

/** Mirrors public.report_target. */
export const REPORT_TARGET_LABEL = {
  message: "Message",
  feedback: "Feedback",
  feedback_reply: "Feedback reply",
} as const;

/** Mirrors public.report_decision. */
export const DECISION_LABEL = {
  dismiss: "Dismiss: no action needed",
  uphold: "Uphold: handled outside the app",
  hide_content: "Hide the content",
} as const;

export const REPORT_STATUS_LABEL = { open: "Open", dismissed: "Dismissed", actioned: "Actioned" } as const;

export type ReportTarget = keyof typeof REPORT_TARGET_LABEL;
export type ReportReason = keyof typeof REPORT_REASON_LABEL;
export type ReportDecision = keyof typeof DECISION_LABEL;
export type ReportStatus = keyof typeof REPORT_STATUS_LABEL;

const reasons = Object.keys(REPORT_REASON_LABEL) as [ReportReason, ...ReportReason[]];
const targets = Object.keys(REPORT_TARGET_LABEL) as [ReportTarget, ...ReportTarget[]];
const decisions = Object.keys(DECISION_LABEL) as [ReportDecision, ...ReportDecision[]];

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value === "" ? null : value));

export const ReportDraft = z.object({
  targetType: z.enum(targets, "That content cannot be reported."),
  targetId: z.uuid("That content cannot be reported."),
  reason: z.enum(reasons, "Choose a reason."),
  details: optionalText(1000, "Details"),
});
export type ReportDraft = z.infer<typeof ReportDraft>;

export const ResolutionDraft = z.object({
  reportId: z.uuid("Report not found."),
  decision: z.enum(decisions, "Choose a decision."),
  note: optionalText(1000, "The note"),
});
export type ResolutionDraft = z.infer<typeof ResolutionDraft>;

function firstIssue(error: z.ZodError) {
  return { ok: false as const, message: error.issues[0]?.message ?? "Some fields are missing or invalid." };
}

export function parseReportForm(formData: FormData) {
  const parsed = ReportDraft.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
    reason: formData.get("reason"),
    details: formData.get("details") ?? "",
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export function parseResolutionForm(formData: FormData) {
  const parsed = ResolutionDraft.safeParse({
    reportId: formData.get("reportId"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return firstIssue(parsed.error);
  if (parsed.data.decision === "hide_content" && formData.get("targetType") === "feedback") {
    return { ok: false as const, message: "Feedback cannot be hidden. Uphold or dismiss the report." };
  }
  return { ok: true as const, data: parsed.data };
}

/** Which decisions apply to a target: feedback items cannot be hidden. */
export function decisionsFor(target: ReportTarget): ReportDecision[] {
  return target === "feedback" ? ["dismiss", "uphold"] : ["dismiss", "uphold", "hide_content"];
}

/** User-facing message for a failed report or resolution, by Postgres/PostgREST error code. */
export function moderationErrorMessage(code: string | undefined, fallback: string) {
  switch (code) {
    case "23505":
      return "You have already reported this.";
    case "PT429":
      return "You have sent a lot of reports recently. Please wait a while and try again.";
    case "42501":
      return "That can't be done with your account.";
    case "55000":
      return "This report has already been resolved.";
    case "P0002":
      return "That report no longer exists.";
    case "22023":
      return "Feedback cannot be hidden. Uphold or dismiss the report.";
    case "23514":
      return "Some fields are too long.";
    default:
      return fallback;
  }
}

/** A compact, human-readable line for an audit entry's metadata (never message content). */
export function describeAuditMetadata(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}
