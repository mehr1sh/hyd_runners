import { describe, expect, it } from "vitest";
import {
  decisionsFor,
  describeAuditMetadata,
  moderationErrorMessage,
  parseReportForm,
  parseResolutionForm,
} from "@/features/community/logic/moderation";

const id = "11111111-1111-4111-8111-111111111111";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("report form", () => {
  it("accepts a valid report and trims empty details to null", () => {
    expect(parseReportForm(form({ targetType: "message", targetId: id, reason: "spam", details: "   " }))).toEqual({
      ok: true,
      data: { targetType: "message", targetId: id, reason: "spam", details: null },
    });
  });

  it("rejects unknown targets, ids, reasons and long details", () => {
    expect(parseReportForm(form({ targetType: "profile", targetId: id, reason: "spam" })).ok).toBe(false);
    expect(parseReportForm(form({ targetType: "message", targetId: "nope", reason: "spam" })).ok).toBe(false);
    expect(parseReportForm(form({ targetType: "message", targetId: id, reason: "" }))).toEqual({
      ok: false,
      message: "Choose a reason.",
    });
    expect(
      parseReportForm(form({ targetType: "message", targetId: id, reason: "other", details: "x".repeat(1001) })),
    ).toEqual({ ok: false, message: "Details must be 1000 characters or fewer." });
  });
});

describe("resolution form", () => {
  it("accepts a decision with an optional note", () => {
    expect(parseResolutionForm(form({ reportId: id, decision: "hide_content", note: "Threats" }))).toEqual({
      ok: true,
      data: { reportId: id, decision: "hide_content", note: "Threats" },
    });
  });

  it("refuses to hide feedback items", () => {
    expect(parseResolutionForm(form({ reportId: id, decision: "hide_content", targetType: "feedback" })).ok).toBe(
      false,
    );
    expect(decisionsFor("feedback")).toEqual(["dismiss", "uphold"]);
    expect(decisionsFor("message")).toContain("hide_content");
  });

  it("requires a decision", () => {
    expect(parseResolutionForm(form({ reportId: id, decision: "" }))).toEqual({
      ok: false,
      message: "Choose a decision.",
    });
  });
});

describe("moderation errors", () => {
  it("maps database refusals to clear messages", () => {
    expect(moderationErrorMessage("23505", "x")).toBe("You have already reported this.");
    expect(moderationErrorMessage("PT429", "x")).toMatch(/wait a while/);
    expect(moderationErrorMessage("55000", "x")).toBe("This report has already been resolved.");
    expect(moderationErrorMessage("XX000", "fallback")).toBe("fallback");
  });
});

describe("audit metadata", () => {
  it("summarises metadata and skips empty values", () => {
    expect(describeAuditMetadata({ role: "coach", granted_by: null, cause: "role_revoked" })).toBe(
      "role: coach · cause: role_revoked",
    );
  });
});
