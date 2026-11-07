import { describe, expect, it } from "vitest";
import {
  assertGrantableRole,
  canManageCommunity,
  canReviewFeedback,
  hasAnyRole,
} from "@/features/community/logic/access";
import { barrierToTarget, parseFeedbackForm, parseReplyForm } from "@/features/community/logic/feedback";
import { isUnread, isoToLocalInput, localDateTimeToIso } from "@/features/community/logic/dates";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

describe("role gating", () => {
  it("limits management to programme managers and admins", () => {
    expect(canManageCommunity(["programme_manager"])).toBe(true);
    expect(canManageCommunity(["admin"])).toBe(true);
    expect(canManageCommunity(["coach"])).toBe(false);
    expect(canManageCommunity(["mentor"])).toBe(false);
    expect(canManageCommunity(["runner"])).toBe(false);
    expect(canManageCommunity([])).toBe(false);
  });

  it("hasAnyRole matches any entry", () => {
    expect(hasAnyRole(["runner", "coach"], ["coach", "admin"])).toBe(true);
    expect(hasAnyRole(["runner"], ["coach", "admin"])).toBe(false);
  });

  it("only grants coach or mentor", () => {
    expect(assertGrantableRole("coach")).toBe(true);
    expect(assertGrantableRole("mentor")).toBe(true);
    expect(assertGrantableRole("programme_manager")).toBe(false);
    expect(assertGrantableRole("admin")).toBe(false);
    expect(assertGrantableRole("runner")).toBe(false);
  });
});

describe("canReviewFeedback", () => {
  it("lets the author read their own feedback", () => {
    expect(canReviewFeedback(["runner"], { userId, assignedTo: null }, userId)).toBe(true);
  });

  it("denies other runners", () => {
    expect(canReviewFeedback(["runner"], { userId: otherId, assignedTo: null }, userId)).toBe(false);
  });

  it("lets managers read any feedback", () => {
    expect(canReviewFeedback(["programme_manager"], { userId: otherId, assignedTo: null }, userId)).toBe(true);
  });

  it("lets an assigned coach read only their assignment", () => {
    expect(canReviewFeedback(["coach"], { userId: otherId, assignedTo: userId }, userId)).toBe(true);
    expect(canReviewFeedback(["coach"], { userId: otherId, assignedTo: otherId }, userId)).toBe(false);
  });

  it("does not let an unassigned coach read feedback", () => {
    expect(canReviewFeedback(["coach"], { userId: otherId, assignedTo: null }, userId)).toBe(false);
  });
});

describe("barrierToTarget", () => {
  it("routes programme barriers to the programme target", () => {
    expect(barrierToTarget("programme")).toBe("programme");
  });

  it("routes everything else to the app target", () => {
    for (const barrier of ["consistency", "schedule_conflicts", "motivation", "other"] as const) {
      expect(barrierToTarget(barrier)).toBe("app");
    }
  });
});

function form(entries: Record<string, string | null>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) if (value !== null) data.set(key, value);
  return data;
}

describe("parseFeedbackForm", () => {
  it("parses a valid submission with a rating", () => {
    const result = parseFeedbackForm(form({ barrier: "consistency", body: "Hard to keep up", rating: "4" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rating).toBe(4);
      expect(result.data.barrier).toBe("consistency");
    }
  });

  it("allows a missing rating", () => {
    const result = parseFeedbackForm(form({ barrier: "motivation", body: "Meh", rating: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rating).toBeNull();
  });

  it("rejects an empty body", () => {
    expect(parseFeedbackForm(form({ barrier: "other", body: "   " })).ok).toBe(false);
  });

  it("rejects an unknown barrier", () => {
    expect(parseFeedbackForm(form({ barrier: "nonsense", body: "x" })).ok).toBe(false);
  });

  it("rejects ratings outside 1-5", () => {
    expect(parseFeedbackForm(form({ barrier: "other", body: "x", rating: "9" })).ok).toBe(false);
    expect(parseFeedbackForm(form({ barrier: "other", body: "x", rating: "0" })).ok).toBe(false);
  });
});

describe("parseReplyForm", () => {
  it("parses a valid reply", () => {
    const result = parseReplyForm(form({ feedbackId: userId, body: "Thanks for flagging" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an empty reply", () => {
    expect(parseReplyForm(form({ feedbackId: userId, body: "" })).ok).toBe(false);
  });

  it("rejects a missing feedback id", () => {
    expect(parseReplyForm(form({ feedbackId: null, body: "hi" })).ok).toBe(false);
  });
});

describe("announcement dates", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");

  it("marks published unread announcements as unread", () => {
    expect(isUnread("2026-10-14T10:00:00Z", null, now)).toBe(true);
  });

  it("marks read announcements as read", () => {
    expect(isUnread("2026-10-14T10:00:00Z", "2026-10-14T11:00:00Z", now)).toBe(false);
  });

  it("never marks a scheduled announcement as unread", () => {
    expect(isUnread("2026-10-15T10:00:00Z", null, now)).toBe(false);
  });

  it("converts a local datetime to the right instant in Asia/Kolkata", () => {
    const iso = localDateTimeToIso("2026-10-20T06:30");
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).getTime()).toBe(Date.parse("2026-10-20T01:00:00Z"));
  });

  it("rejects malformed local datetimes", () => {
    expect(localDateTimeToIso("2026-13-40T99:99")).toBeNull();
    expect(localDateTimeToIso("tomorrow")).toBeNull();
  });

  it("round-trips an ISO instant back to a local input value", () => {
    expect(isoToLocalInput("2026-10-20T01:00:00Z")).toBe("2026-10-20T06:30");
    expect(isoToLocalInput("not-a-date")).toBe("");
  });
});
