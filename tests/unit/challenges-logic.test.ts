import { describe, expect, it } from "vitest";
import { displayValue, parseChallengeForm, percent, progressLabel } from "@/features/challenges/logic";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

describe("challenges", () => {
  it("shows distances in km and counts as whole numbers", () => {
    expect(progressLabel("distance", 12345, 20000)).toBe("12.3 of 20 km");
    expect(progressLabel("active_days", 7, 5)).toBe("5 of 5 days");
    expect(displayValue("longest_run", 10000)).toBe(10);
    expect(percent(15, 10)).toBe(100);
    expect(percent(-1, 10)).toBe(0);
  });

  it("parses the form, storing distance goals in metres", () => {
    expect(
      parseChallengeForm(
        form({
          title: "Big month",
          kind: "distance",
          goal: "42.2",
          startsOn: "2026-11-10",
          endsOn: "2026-11-30",
          rewardXp: "100",
        }),
      ),
    ).toMatchObject({ ok: true, data: { goal: 42200, collective: false, clubId: null } });
    expect(
      parseChallengeForm(
        form({ title: "Days", kind: "active_days", goal: "5", startsOn: "2026-11-10", endsOn: "2026-11-30" }),
      ),
    ).toMatchObject({
      ok: true,
      data: { goal: 5 },
    });
  });

  it("rejects backwards dates, unknown kinds and group goals that make no sense", () => {
    expect(
      parseChallengeForm(
        form({ title: "Oops", kind: "active_days", goal: "5", startsOn: "2026-11-30", endsOn: "2026-11-10" }),
      ),
    ).toEqual({
      ok: false,
      message: "The end date must be on or after the start date.",
    });
    expect(
      parseChallengeForm(
        form({ title: "Oops", kind: "speed", goal: "5", startsOn: "2026-11-10", endsOn: "2026-11-30" }),
      ).ok,
    ).toBe(false);
    expect(
      parseChallengeForm(
        form({
          title: "Oops",
          kind: "longest_run",
          goal: "10",
          collective: "on",
          startsOn: "2026-11-10",
          endsOn: "2026-11-30",
        }),
      ),
    ).toEqual({ ok: false, message: "That kind of challenge can't be a group goal." });
  });
});
