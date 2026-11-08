import { NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import {
  CSP_REPORT_TYPES,
  type CspReportType,
  logViolations,
  MAX_REPORT_BYTES,
  readCapped,
  toViolations,
} from "@/lib/security/csp-report";

/**
 * POST /api/v1/csp-report — receives Content Security Policy violation
 * reports from browsers (see src/lib/security/headers.ts). Accepts the legacy
 * `report-uri` format (`application/csp-report`) and the Reporting API format
 * (`application/reports+json`). Unauthenticated by design; bodies are capped,
 * and each violation is logged as one compact line without query strings,
 * fragments, cookies or script samples. Always answers 204 for a well-formed
 * report and never throws.
 */
export async function POST(request: Request) {
  try {
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!CSP_REPORT_TYPES.includes(contentType as CspReportType)) {
      return fail("unsupported_media_type", "Expected application/csp-report or application/reports+json.");
    }
    const text = await readCapped(request, MAX_REPORT_BYTES);
    if (text === null) return fail("payload_too_large", "Report is too large.");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail("bad_request", "Report must be valid JSON.");
    }
    const violations = toViolations(contentType as CspReportType, raw);
    if (!violations) return fail("bad_request", "Not a CSP violation report.");

    logViolations(violations);
    return new NextResponse(null, { status: 204 });
  } catch {
    // Reports are best effort; never surface an error to the browser.
    return new NextResponse(null, { status: 204 });
  }
}
