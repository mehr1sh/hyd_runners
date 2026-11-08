import { z } from "zod";

/** Parsing and logging for CSP violation reports (POST /api/v1/csp-report). */

export const MAX_REPORT_BYTES = 8 * 1024;
export const CSP_REPORT_TYPES = ["application/csp-report", "application/reports+json"] as const;
export type CspReportType = (typeof CSP_REPORT_TYPES)[number];
const MAX_LOGGED = 10;

const LegacyReport = z.object({
  "csp-report": z.looseObject({
    "document-uri": z.string().optional(),
    "blocked-uri": z.string().optional(),
    "effective-directive": z.string().optional(),
    "violated-directive": z.string().optional(),
    disposition: z.string().optional(),
    "source-file": z.string().optional(),
    "line-number": z.number().optional(),
  }),
});

const ReportingApiReports = z
  .array(
    z.looseObject({
      type: z.string(),
      url: z.string().optional(),
      body: z
        .looseObject({
          documentURL: z.string().optional(),
          blockedURL: z.string().optional(),
          effectiveDirective: z.string().optional(),
          disposition: z.string().optional(),
          sourceFile: z.string().optional(),
          lineNumber: z.number().optional(),
        })
        .optional(),
    }),
  )
  .max(100);

export type Violation = {
  document?: string;
  blocked?: string;
  directive?: string;
  disposition?: string;
  source?: string;
  line?: number;
};

/**
 * A reported URL reduced to something safe to log: http(s) URLs lose their
 * query string and fragment (they can carry tokens or personal data), other
 * schemes (data:, blob:) are reduced to the scheme, and keywords such as
 * "inline" or "eval" pass through. Always one printable line, bounded length.
 */
export function stripUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let out: string;
  try {
    const u = new URL(value);
    out =
      u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:"
        ? `${u.origin}${u.pathname}`
        : u.protocol.replace(/:$/, "");
  } catch {
    out = value.split(/[?#]/)[0];
  }
  return out.replace(/[^\x21-\x7e]/g, "").slice(0, 200) || undefined;
}

function token(value: string | undefined) {
  return value?.replace(/[^\w-]/g, "").slice(0, 40) || undefined;
}

export function formatViolation(v: Violation): string {
  const parts = [
    `directive=${token(v.directive) ?? "?"}`,
    `disposition=${token(v.disposition) ?? "?"}`,
    `blocked=${stripUrl(v.blocked) ?? "?"}`,
    `document=${stripUrl(v.document) ?? "?"}`,
  ];
  const source = stripUrl(v.source);
  if (source) parts.push(`source=${source}${Number.isInteger(v.line) ? `:${v.line}` : ""}`);
  return `[csp-violation] ${parts.join(" ")}`;
}

/** Read at most `limit` bytes; null if the body is larger. */
export async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function toViolations(contentType: CspReportType, raw: unknown): Violation[] | null {
  if (contentType === "application/csp-report") {
    const parsed = LegacyReport.safeParse(raw);
    if (!parsed.success) return null;
    const r = parsed.data["csp-report"];
    return [
      {
        document: r["document-uri"],
        blocked: r["blocked-uri"],
        directive: r["effective-directive"] ?? r["violated-directive"],
        disposition: r.disposition,
        source: r["source-file"],
        line: r["line-number"],
      },
    ];
  }
  const parsed = ReportingApiReports.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data
    .filter((r) => r.type === "csp-violation" && r.body)
    .map((r) => ({
      document: r.body?.documentURL ?? r.url,
      blocked: r.body?.blockedURL,
      directive: r.body?.effectiveDirective,
      disposition: r.body?.disposition,
      source: r.body?.sourceFile,
      line: r.body?.lineNumber,
    }));
}

/** Log up to MAX_LOGGED violations, one `console.warn` line each. */
export function logViolations(violations: Violation[]) {
  for (const v of violations.slice(0, MAX_LOGGED)) console.warn(formatViolation(v));
}
