import { describe, expect, it } from "vitest";
import {
  checkDeclaredFile,
  checkStoredBytes,
  deriveFreeFromBusy,
  freeIntervals,
  MAX_TIMETABLE_BYTES,
  parseTimetableText,
  sniffMimeType,
  validateAvailability,
} from "@/features/scheduler/logic";
import { draft, makeKey } from "./fixtures";

describe("availability validation (Case C: conflicting availability)", () => {
  it("accepts a clean recurring week", () => {
    const r = validateAvailability([draft(1, "06:00", "07:00"), draft(1, "09:00", "17:00", "busy")], {
      requireFreeTime: true,
    });
    expect(r.ok).toBe(true);
    expect(r.blocks).toHaveLength(2);
  });

  it("rejects end-before-start with advice for overnight periods", () => {
    const r = validateAvailability([draft(2, "22:00", "01:00")]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ code: "end_before_start", index: 0, field: "endTime" });
    expect(r.issues[0].message).toMatch(/two rows/);
  });

  it("rejects overlapping periods of the same kind instead of merging silently", () => {
    const r = validateAvailability([draft(3, "06:00", "08:00"), draft(3, "07:30", "09:00")]);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("overlap_same_kind");
  });

  it("warns (but does not block) when free time overlaps busy time, and busy wins", () => {
    const drafts = [draft(4, "06:00", "10:00"), draft(4, "08:00", "09:00", "busy")];
    const r = validateAvailability(drafts);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([expect.objectContaining({ code: "free_overlaps_busy", severity: "warning" })]);
    expect(freeIntervals(r.blocks)[4]).toEqual([
      { start: 360, end: 480 },
      { start: 540, end: 600 },
    ]);
  });

  it("requires some confirmed free time before scheduling", () => {
    const r = validateAvailability([draft(1, "09:00", "17:00", "busy")], { requireFreeTime: true });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("no_free_time");
  });

  it("requires extracted rows to be confirmed", () => {
    const r = validateAvailability([draft(1, "06:00", "07:00", "free", { confirmed: false, source: "text_parser" })], {
      requireConfirmed: true,
    });
    expect(r.issues.map((i) => i.code)).toContain("unconfirmed");
  });

  it("fills gaps between busy times only when asked, as unconfirmed rows inside the chosen window", () => {
    const busy = [draft(1, "09:00", "12:00", "busy"), draft(1, "13:00", "17:00", "busy")];
    const gaps = deriveFreeFromBusy(busy, { weekdays: [1], from: "06:00", to: "20:00", makeKey });
    expect(gaps.map((g) => [g.startTime, g.endTime])).toEqual([
      ["06:00", "09:00"],
      ["12:00", "13:00"],
      ["17:00", "20:00"],
    ]);
    expect(gaps.every((g) => !g.confirmed && g.kind === "free")).toBe(true);
  });
});

describe("timetable text parser", () => {
  it("reads a clear weekly timetable", () => {
    const text = `Semester timetable
Monday 09:00-10:30 Physics
Monday 11:00 - 12:30 Chemistry
Tuesday 2:00 PM - 3:30 PM Lab
Wed 14:00–16:00 Maths`;
    const r = parseTimetableText(text, makeKey);
    expect(r.status).toBe("complete");
    expect(r.drafts.map((d) => [d.weekday, d.startTime, d.endTime, d.kind, d.label])).toEqual([
      [1, "09:00", "10:30", "busy", "Physics"],
      [1, "11:00", "12:30", "busy", "Chemistry"],
      [2, "14:00", "15:30", "busy", "Lab"],
      [3, "14:00", "16:00", "busy", "Maths"],
    ]);
    expect(r.drafts.every((d) => !d.confirmed && d.source === "text_parser")).toBe(true);
    expect(r.notes.join(" ")).toMatch(/busy times only/);
  });

  it("uses day headings for following lines and expands day ranges", () => {
    const r = parseTimetableText("THURSDAY\n08:00-09:00 English\nMon-Wed 17:00-18:00 Work", makeKey);
    expect(r.drafts.map((d) => [d.weekday, d.startTime])).toEqual([
      [4, "08:00"],
      [1, "17:00"],
      [2, "17:00"],
      [3, "17:00"],
    ]);
  });

  it("shares AM/PM across a range only when it keeps the order", () => {
    const r = parseTimetableText("Fri 2-3pm Seminar\nFri 11-1pm Lecture", makeKey);
    expect(r.drafts.map((d) => [d.startTime, d.endTime])).toEqual([
      ["14:00", "15:00"],
      ["11:00", "13:00"],
    ]);
  });

  describe("Case D: ambiguous timetable", () => {
    it("does not guess AM/PM for hours 1–7 and flags it", () => {
      const r = parseTimetableText("Monday 2-4 Tutorial", makeKey);
      expect(r.status).toBe("partial");
      expect(r.drafts[0]).toMatchObject({ weekday: 1, startTime: null, endTime: null });
      expect(r.drafts[0].uncertainties.join(" ")).toMatch(/AM or PM/);
    });

    it("flags a missing day instead of inventing one", () => {
      const r = parseTimetableText("10:00-11:00 Physics", makeKey);
      expect(r.drafts[0].weekday).toBeNull();
      expect(r.drafts[0].uncertainties.join(" ")).toMatch(/No day/);
    });

    it("flags a missing end time", () => {
      const r = parseTimetableText("Tuesday 10:30 Meeting", makeKey);
      expect(r.drafts[0]).toMatchObject({ weekday: 2, startTime: "10:30", endTime: null });
    });

    it("flags one-off dates because only weekly repeats are stored", () => {
      const r = parseTimetableText("Wed 12/11/2026 10:00-12:00 Mid-term exam", makeKey);
      expect(r.drafts[0].uncertainties.join(" ")).toMatch(/repeats every week/);
    });

    it("does not match times to days in a grid layout", () => {
      const r = parseTimetableText("Mon Tue Wed Thu Fri\n09:00-10:00 Physics Chem Maths", makeKey);
      expect(r.drafts[0].weekday).toBeNull();
      expect(r.notes.join(" ")).toMatch(/grid/);
    });

    it("flags hours 8–12 without AM/PM as read-as-written", () => {
      const r = parseTimetableText("Sat 8-10 Football", makeKey);
      expect(r.drafts[0]).toMatchObject({ startTime: "08:00", endTime: "10:00" });
      expect(r.drafts[0].confidence).toBeLessThan(0.7);
      expect(r.drafts[0].uncertainties.length).toBeGreaterThan(0);
    });
  });

  describe("Case E: missing timetable information", () => {
    it("reports empty when the text has no times", () => {
      const r = parseTimetableText("Department of Physics\nWelcome to the new semester", makeKey);
      expect(r.status).toBe("empty");
      expect(r.drafts).toEqual([]);
    });

    it("reports empty for whitespace-only text (e.g. a scanned PDF)", () => {
      expect(parseTimetableText("   \n \n", makeKey).status).toBe("empty");
    });

    it("reports partial, not complete, when some lines cannot be read", () => {
      const r = parseTimetableText("Monday 09:00-10:00 Physics\nRoom 3: 09 : 00 – ?? Chem", makeKey);
      expect(r.status).toBe("partial");
      expect(r.notes.join(" ")).toMatch(/could not be read/);
    });
  });
});

describe("Case F: invalid or unsupported uploads", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it("rejects empty, oversized and unsupported files before upload", () => {
    expect(checkDeclaredFile({ type: "application/pdf", size: 0 })?.code).toBe("empty_file");
    expect(checkDeclaredFile({ type: "application/pdf", size: MAX_TIMETABLE_BYTES + 1 })?.code).toBe("file_too_large");
    expect(checkDeclaredFile({ type: "application/vnd.ms-excel", size: 100 })?.code).toBe("unsupported_type");
    expect(checkDeclaredFile({ type: "image/webp", size: 100 })).toBeNull();
  });

  it("identifies files by content, not by name or declared type", () => {
    expect(sniffMimeType(pdf)).toBe("application/pdf");
    expect(sniffMimeType(png)).toBe("image/png");
    expect(sniffMimeType(webp)).toBe("image/webp");
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(new TextEncoder().encode("PK\u0003\u0004 docx"))).toBeNull();
  });

  it("rejects stored bytes that are empty, corrupted or do not match the declared type", () => {
    expect(checkStoredBytes(new Uint8Array(), "application/pdf")?.code).toBe("empty_file");
    expect(checkStoredBytes(new TextEncoder().encode("garbage"), "application/pdf")?.code).toBe("unsupported_type");
    expect(checkStoredBytes(png, "application/pdf")?.code).toBe("content_mismatch");
    expect(checkStoredBytes(pdf, "application/pdf")).toBeNull();
  });
});
