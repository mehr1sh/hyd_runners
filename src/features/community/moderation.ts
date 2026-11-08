import type { SupabaseClient } from "@supabase/supabase-js";
import { profileNames, type ServiceResult } from "@/features/shared/db";
import {
  moderationErrorMessage,
  type ReportDecision,
  type ReportDraft,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
} from "./logic/moderation";

/**
 * Content reports and moderation. All writes go through database functions
 * (report_content, resolve_report); moderators read reported private content
 * only through moderation_report_content, which audits every view.
 */

export const QUEUE_LIMIT = 50;
export const AUDIT_PAGE_SIZE = 50;

export type ReportSummary = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  decision: ReportDecision | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporterName: string;
  subjectName: string;
  resolvedByName: string | null;
  reporterId: string | null;
  subjectId: string | null;
};

export type ReportedContent = {
  targetType: ReportTarget;
  body: string;
  authorName: string;
  createdAt: string;
  hidden: boolean;
};

export type AuditEntry = {
  id: number;
  occurredAt: string;
  actorKind: "user" | "service" | "system";
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  subjectName: string | null;
  metadata: Record<string, unknown>;
};

function failure(error: { code?: string; message?: string }, fallback: string): ServiceResult<never> {
  const message = moderationErrorMessage(error.code, fallback);
  if (message === fallback) console.error(fallback, error.code);
  const code =
    error.code === "PT429"
      ? "rate_limited"
      : error.code === "42501"
        ? "forbidden"
        : error.code === "23505" || error.code === "55000"
          ? "conflict"
          : error.code === "P0002"
            ? "not_found"
            : error.code === "22023" || error.code === "23514"
              ? "validation_failed"
              : "internal_error";
  return { ok: false, code, message };
}

function namesFor(supabase: SupabaseClient, ids: (string | null | undefined)[]) {
  return profileNames(supabase, ids, "moderation");
}

export async function reportContent(supabase: SupabaseClient, draft: ReportDraft): Promise<ServiceResult<string>> {
  const { data, error } = await supabase.rpc("report_content", {
    p_target_type: draft.targetType,
    p_target_id: draft.targetId,
    p_reason: draft.reason,
    p_details: draft.details,
  });
  if (error) return failure(error, "Could not send that report.");
  return { ok: true, data: data as string };
}

/** Ids of the given items the viewer has already reported (RLS: own reports only). */
export async function reportedTargetIds(
  supabase: SupabaseClient,
  viewerId: string,
  targetType: ReportTarget,
  targetIds: string[],
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("content_reports")
    .select("target_id")
    .eq("reporter_id", viewerId)
    .eq("target_type", targetType)
    .in("target_id", targetIds);
  if (error) {
    console.error("Could not load the viewer's reports", error.code);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.target_id as string));
}

type ReportRow = {
  id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  decision: ReportDecision | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  reporter_id: string | null;
  subject_id: string | null;
  resolved_by: string | null;
};

const REPORT_COLUMNS =
  "id, target_type, target_id, reason, details, status, decision, resolution_note, created_at, resolved_at, reporter_id, subject_id, resolved_by";

/** Open reports (oldest first) and the most recently resolved ones, for moderators. */
export async function listReportQueue(
  supabase: SupabaseClient,
): Promise<ServiceResult<{ open: ReportSummary[]; resolved: ReportSummary[]; moreOpen: boolean }>> {
  const [open, resolved] = await Promise.all([
    supabase
      .from("content_reports")
      .select(REPORT_COLUMNS)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(QUEUE_LIMIT + 1),
    supabase
      .from("content_reports")
      .select(REPORT_COLUMNS)
      .neq("status", "open")
      .order("resolved_at", { ascending: false })
      .limit(20),
  ]);
  if (open.error) return failure(open.error, "Could not load the report queue.");
  if (resolved.error) return failure(resolved.error, "Could not load resolved reports.");
  const openRows = (open.data ?? []) as ReportRow[];
  const resolvedRows = (resolved.data ?? []) as ReportRow[];
  const rows = [...openRows.slice(0, QUEUE_LIMIT), ...resolvedRows];
  const names = await namesFor(
    supabase,
    rows.flatMap((row) => [row.reporter_id, row.subject_id, row.resolved_by]),
  );
  const toSummary = (row: ReportRow): ReportSummary => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    decision: row.decision,
    resolutionNote: row.resolution_note,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    reporterId: row.reporter_id,
    subjectId: row.subject_id,
    reporterName: row.reporter_id ? (names.get(row.reporter_id) ?? "Member") : "Deleted account",
    subjectName: row.subject_id ? (names.get(row.subject_id) ?? "Member") : "Deleted account",
    resolvedByName: row.resolved_by ? (names.get(row.resolved_by) ?? "Moderator") : null,
  });
  return {
    ok: true,
    data: {
      open: openRows.slice(0, QUEUE_LIMIT).map(toSummary),
      resolved: resolvedRows.map(toSummary),
      moreOpen: openRows.length > QUEUE_LIMIT,
    },
  };
}

/** The reported item itself. Audited in the database on every call. */
export async function viewReportedContent(
  supabase: SupabaseClient,
  reportId: string,
): Promise<ServiceResult<ReportedContent>> {
  const { data, error } = await supabase.rpc("moderation_report_content", { p_report_id: reportId });
  if (error) return failure(error, "Could not open the reported content.");
  const row = (data ?? [])[0] as
    | {
        target_type: ReportTarget;
        body: string;
        author_name: string | null;
        created_at: string;
        hidden_at: string | null;
      }
    | undefined;
  if (!row) return { ok: false, code: "not_found", message: "The reported content no longer exists." };
  return {
    ok: true,
    data: {
      targetType: row.target_type,
      body: row.body,
      authorName: row.author_name ?? "Deleted account",
      createdAt: new Date(row.created_at).toISOString(),
      hidden: row.hidden_at !== null,
    },
  };
}

export async function resolveReport(
  supabase: SupabaseClient,
  input: { reportId: string; decision: ReportDecision; note: string | null },
): Promise<ServiceResult<null>> {
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: input.reportId,
    p_decision: input.decision,
    p_note: input.note,
  });
  if (error) return failure(error, "Could not record that decision.");
  return { ok: true, data: null };
}

/** Newest audit entries first; pass the last id seen to page back. Admins only (RLS). */
export async function listAuditLog(
  supabase: SupabaseClient,
  options: { before?: number } = {},
): Promise<ServiceResult<{ entries: AuditEntry[]; nextBefore: number | null }>> {
  let query = supabase
    .from("audit_log")
    .select("id, occurred_at, actor_id, actor_kind, action, target_type, target_id, subject_id, metadata")
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1);
  if (options.before) query = query.lt("id", options.before);
  const { data, error } = await query;
  if (error) return failure(error, "Could not load the audit log.");
  const rows = (data ?? []) as {
    id: number;
    occurred_at: string;
    actor_id: string | null;
    actor_kind: AuditEntry["actorKind"];
    action: string;
    target_type: string;
    target_id: string | null;
    subject_id: string | null;
    metadata: Record<string, unknown> | null;
  }[];
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const names = await namesFor(
    supabase,
    page.flatMap((row) => [row.actor_id, row.subject_id]),
  );
  return {
    ok: true,
    data: {
      entries: page.map((row) => ({
        id: row.id,
        occurredAt: new Date(row.occurred_at).toISOString(),
        actorKind: row.actor_kind,
        actorName: row.actor_id
          ? (names.get(row.actor_id) ?? "Deleted account")
          : row.actor_kind === "service"
            ? "Service"
            : "System",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        subjectName: row.subject_id ? (names.get(row.subject_id) ?? "Deleted account") : null,
        metadata: row.metadata ?? {},
      })),
      nextBefore: rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1].id : null,
    },
  };
}
