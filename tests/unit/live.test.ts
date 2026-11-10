import { describe, expect, it } from "vitest";
import { ageLabel, freshness, PositionBody } from "@/features/live/logic";

describe("live positions", () => {
  const now = Date.parse("2026-11-09T06:00:00Z");
  it("never treats an old position as current", () => {
    expect(freshness("2026-11-09T05:59:30Z", now)).toBe("live");
    expect(freshness("2026-11-09T05:58:00Z", now)).toBe("stale");
    expect(freshness("2026-11-09T05:45:00Z", now)).toBe("lost");
  });
  it("labels ages", () => {
    expect(ageLabel("2026-11-09T05:59:30Z", now)).toBe("30s ago");
    expect(ageLabel("2026-11-09T05:55:00Z", now)).toBe("5 min ago");
  });
  it("validates uploads", () => {
    expect(
      PositionBody.safeParse({ lat: 17.4, lon: 78.4, accuracy: 8, recordedAt: "2026-11-09T06:00:00Z" }).success,
    ).toBe(true);
    expect(
      PositionBody.safeParse({ lat: 117, lon: 78.4, accuracy: 8, recordedAt: "2026-11-09T06:00:00Z" }).success,
    ).toBe(false);
  });
});
