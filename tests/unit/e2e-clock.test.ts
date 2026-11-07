import { describe, expect, it } from "vitest";

import { localDate, localHour, weekStart } from "@/features/gamification/logic/time";
import { isValidTimeZone } from "@/features/identity/logic/onboarding";
import { middayTimezone } from "../e2e/support/clock";

describe("middayTimezone", () => {
  // Every quarter hour of a day, starting on a Monday.
  const instants = Array.from({ length: 96 }, (_, i) => new Date(Date.UTC(2026, 10, 9, 0, i * 15, 30)));

  it("returns a valid timezone where the local time is midday", () => {
    for (const now of instants) {
      const zone = middayTimezone(now);
      expect(isValidTimeZone(zone), zone).toBe(true);
      expect(localHour(now, zone), `${now.toISOString()} in ${zone}`).toBe(12);
    }
  });

  it("keeps a workout backdated by up to 6 hours on the same local day and week", () => {
    for (const now of instants) {
      const zone = middayTimezone(now);
      const start = new Date(now.getTime() - 6 * 3_600_000);
      expect(localDate(start, zone)).toBe(localDate(now, zone));
      expect(weekStart(localDate(start, zone))).toBe(weekStart(localDate(now, zone)));
    }
  });

  it("reproduces the CI failure window for the default timezone", () => {
    // CI run 42402511972 completed the workout at 00:14 IST.
    const now = new Date("2026-11-07T18:44:30Z");
    const backdated = new Date(now.getTime() - 30 * 60_000);
    expect(localDate(backdated, "Asia/Kolkata")).not.toBe(localDate(now, "Asia/Kolkata"));
    const zone = middayTimezone(now);
    expect(localDate(backdated, zone)).toBe(localDate(now, zone));
  });
});
