import { describe, expect, it } from "vitest";
import { formatLocalTime, parseSeriesForm, weekdayName } from "@/features/group-runs/logic";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

describe("group runs", () => {
  it("names ISO weekdays and formats local times", () => {
    expect(weekdayName(1)).toBe("Monday");
    expect(weekdayName(6)).toBe("Saturday");
    expect(weekdayName(7)).toBe("Sunday");
    expect(formatLocalTime("06:00:00")).toBe("6:00 am");
    expect(formatLocalTime("18:30")).toBe("6:30 pm");
    expect(formatLocalTime("00:05")).toBe("12:05 am");
  });

  it("parses the series form with sensible defaults", () => {
    const parsed = parseSeriesForm(
      form({
        title: "Dawn loop",
        weekday: "6",
        startTime: "06:00",
        durationMinutes: "60",
        noDrop: "on",
        regroupPolicy: "Regroup at each km",
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      data: { clubId: null, weekday: 6, startTime: "06:00", capacity: null, beginnerFriendly: false, noDrop: true },
    });
  });

  it("rejects missing days, bad times and empty regroup policies", () => {
    expect(parseSeriesForm(form({ title: "Dawn loop", weekday: "0", startTime: "06:00", regroupPolicy: "x" })).ok).toBe(
      false,
    );
    expect(parseSeriesForm(form({ title: "Dawn loop", weekday: "6", startTime: "25:00", regroupPolicy: "x" }))).toEqual(
      {
        ok: false,
        message: "Choose a start time.",
      },
    );
    expect(parseSeriesForm(form({ title: "Dawn loop", weekday: "6", startTime: "06:00", regroupPolicy: "" })).ok).toBe(
      false,
    );
  });
});
