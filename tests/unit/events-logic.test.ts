import { describe, expect, it } from "vitest";
import {
  buildIcs,
  countdown,
  countdownLabel,
  filterHref,
  formatDuration,
  formatPace,
  paceRangeLabel,
  parseDuration,
  parseEventFilters,
  parsePace,
  parsePaceGroupForm,
  parseResultForm,
} from "@/features/events/logic";

const uuid = "11111111-1111-4111-8111-111111111111";
const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

describe("filters", () => {
  it("parses known values and ignores the rest", () => {
    expect(
      parseEventFilters({ when: "past", category: "race", location: uuid, before: "2026-11-01T10:00:00.000Z" }),
    ).toEqual({
      when: "past",
      category: "race",
      locationId: uuid,
      cursor: "2026-11-01T10:00:00.000Z",
    });
    expect(parseEventFilters({ when: "soon", category: "party", location: "x", after: "nope" })).toEqual({
      when: "upcoming",
      category: null,
      locationId: null,
      cursor: null,
    });
  });

  it("builds links that reset the cursor unless given", () => {
    const f = parseEventFilters({ category: "beginner", after: "2026-11-01T10:00:00.000Z" });
    expect(filterHref(f, { when: "past" })).toBe("/events?when=past&category=beginner");
    expect(filterHref(f, { cursor: "2026-11-02T10:00:00.000Z" })).toBe(
      "/events?category=beginner&after=2026-11-02T10%3A00%3A00.000Z",
    );
    expect(filterHref(f, { category: null })).toBe("/events");
  });
});

describe("pace and time", () => {
  it("formats and parses paces", () => {
    expect(formatPace(330)).toBe("5:30");
    expect(parsePace("6:05")).toBe(365);
    expect(parsePace("")).toBeNull();
    expect(parsePace("6:75")).toBeNaN();
    expect(paceRangeLabel(330, 360, false)).toBe("5:30–6:00 min/km");
    expect(paceRangeLabel(null, null, true)).toBe("Run-walk");
  });

  it("formats and parses finish times", () => {
    expect(formatDuration(1745)).toBe("29:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(parseDuration("29:05")).toBe(1745);
    expect(parseDuration("1:02:05")).toBe(3725);
    expect(parseDuration("abc")).toBeNaN();
  });

  it("counts down to the start and stops once it has begun", () => {
    const now = Date.parse("2026-11-08T00:00:00Z");
    expect(countdownLabel(countdown(now, "2026-11-10T03:00:00Z"))).toBe("Starts in 2 days, 3 h");
    expect(countdownLabel(countdown(now, "2026-11-08T01:30:00Z"))).toBe("Starts in 1 h 30 min");
    expect(countdown(now, "2026-11-07T23:00:00Z")).toBeNull();
  });
});

describe("calendar export", () => {
  it("produces a valid, escaped single-event calendar", () => {
    const ics = buildIcs({
      id: uuid,
      title: "Sunrise 5K, Gandipet; bring water",
      description: "Line one\nLine two",
      startsAt: "2026-11-15T01:30:00.000Z",
      endsAt: "2026-11-15T02:30:00.000Z",
      location: "Gandipet Lake Park",
      url: `https://hydrunners.vercel.app/events/${uuid}`,
      now: new Date("2026-11-08T00:00:00Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261115T013000Z\r\n");
    expect(ics).toContain(String.raw`SUMMARY:Sunrise 5K\, Gandipet\; bring water`);
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics.split("\r\n").every((line) => line.length <= 75)).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});

describe("organiser forms", () => {
  it("accepts a pace group and rejects a reversed range", () => {
    expect(
      parsePaceGroupForm(form({ eventId: uuid, label: "Steady", minPace: "6:00", maxPace: "6:30" })),
    ).toMatchObject({
      ok: true,
      data: { minPace: 360, maxPace: 390, runWalk: false, notes: null },
    });
    expect(parsePaceGroupForm(form({ eventId: uuid, label: "x", minPace: "6:30", maxPace: "6:00" })).ok).toBe(false);
    expect(parsePaceGroupForm(form({ eventId: uuid, label: "x", minPace: "fast" }))).toEqual({
      ok: false,
      message: "Write paces as m:ss, e.g. 5:30.",
    });
  });

  it("accepts results and keeps times for finishers only", () => {
    expect(
      parseResultForm(form({ eventId: uuid, userId: uuid, outcome: "finished", finishTime: "29:05" })),
    ).toMatchObject({
      ok: true,
      data: { finishSeconds: 1745 },
    });
    expect(parseResultForm(form({ eventId: uuid, userId: uuid, outcome: "dnf", finishTime: "29:05" })).ok).toBe(false);
    expect(parseResultForm(form({ eventId: uuid, userId: uuid, outcome: "dns", finishTime: "" }))).toMatchObject({
      ok: true,
      data: { finishSeconds: null },
    });
  });
});
