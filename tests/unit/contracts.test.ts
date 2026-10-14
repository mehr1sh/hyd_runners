import { describe, expect, it } from "vitest";
import {
  AvailabilityBlock,
  CommunityEvent,
  ERROR_STATUS,
  ErrorCode,
  ExtractedTimetable,
  LocalTime,
  Role,
} from "@/lib/contracts";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("shared contracts", () => {
  it("accepts 24-hour HH:mm local times only", () => {
    expect(LocalTime.safeParse("06:30").success).toBe(true);
    expect(LocalTime.safeParse("23:59").success).toBe(true);
    expect(LocalTime.safeParse("24:00").success).toBe(false);
    expect(LocalTime.safeParse("6:30").success).toBe(false);
  });

  it("rejects availability blocks that end before they start", () => {
    const base = {
      id: uuid,
      userId: uuid,
      weekday: 1,
      kind: "busy",
      label: null,
      source: "manual",
      sourceUploadId: null,
      confidence: null,
    } as const;
    expect(AvailabilityBlock.safeParse({ ...base, startTime: "09:00", endTime: "10:00" }).success).toBe(true);
    expect(AvailabilityBlock.safeParse({ ...base, startTime: "10:00", endTime: "09:00" }).success).toBe(false);
  });

  it("rejects events that end before they start", () => {
    const result = CommunityEvent.safeParse({
      id: uuid,
      title: "Run",
      description: "",
      startsAt: "2026-10-20T01:00:00Z",
      endsAt: "2026-10-20T00:30:00Z",
      locationId: null,
      capacity: null,
      status: "published",
      createdBy: null,
    });
    expect(result.success).toBe(false);
  });

  it("defaults extracted timetables to Asia/Kolkata", () => {
    const parsed = ExtractedTimetable.parse({ blocks: [], notes: null });
    expect(parsed.timezone).toBe("Asia/Kolkata");
  });

  it("maps every error code to an HTTP status", () => {
    for (const code of ErrorCode.options) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it("matches the database role enum", () => {
    expect(Role.options).toEqual(["runner", "coach", "mentor", "programme_manager", "admin"]);
  });
});
