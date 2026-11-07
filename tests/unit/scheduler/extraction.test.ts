// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/lib/ai/structured";
import { processTimetable } from "@/features/scheduler/server/extraction";
import { extractPdfText } from "@/features/scheduler/server/pdf-text";
import { makeKey } from "./fixtures";
import { buildPdf } from "./pdf-fixture";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const run = (
  bytes: Uint8Array,
  mimeType: "application/pdf" | "image/png",
  aiExtract: Parameters<typeof processTimetable>[0]["aiExtract"] = null,
) => processTimetable({ bytes, mimeType, extractPdfText, aiExtract, makeKey });

describe("timetable processing pipeline", () => {
  it("reads a text PDF without calling AI", async () => {
    const aiExtract = vi.fn();
    const r = await run(
      buildPdf(["Monday 09:00-11:00 Physics", "Friday 13:00-15:00 Lab"]),
      "application/pdf",
      aiExtract,
    );
    expect(r).toMatchObject({ ok: true, method: "text_parser", completeness: "complete" });
    expect(aiExtract).not.toHaveBeenCalled();
  });

  describe("Case E: missing timetable information", () => {
    it("reports a PDF with no text layer (scanned) and points to manual entry when AI is off", async () => {
      const r = await run(buildPdf([]), "application/pdf");
      expect(r).toMatchObject({ ok: false, code: "no_text", retryable: false });
      if (!r.ok) expect(r.message).toMatch(/by hand/);
    });

    it("reports a PDF with text but no timetable", async () => {
      const r = await run(buildPdf(["Welcome to the Department of Physics"]), "application/pdf");
      expect(r).toMatchObject({ ok: false, code: "nothing_found" });
    });

    it("marks partially readable timetables as partial, never complete", async () => {
      const r = await run(buildPdf(["Monday 09:00-10:00 Physics", "Tuesday 2-4 Tutorial"]), "application/pdf");
      expect(r).toMatchObject({ ok: true, completeness: "partial" });
      if (r.ok) expect(r.drafts.find((d) => d.weekday === 2)?.startTime).toBeNull();
    });

    it("reports corrupted PDFs", async () => {
      const r = await run(new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf"), "application/pdf");
      expect(r).toMatchObject({ ok: false, code: "corrupted_pdf" });
    });

    it("keeps the text reader's rows when the AI check fails, and says so", async () => {
      const r = await run(
        buildPdf(["Monday 09:00-10:00 Physics", "Tuesday 2-4 Tutorial"]),
        "application/pdf",
        async () => {
          throw new AiProviderError("timeout", "x");
        },
      );
      expect(r).toMatchObject({ ok: true, method: "text_parser", completeness: "partial" });
      expect(r.ai).toMatchObject({ attempted: true, ok: false, kind: "timeout" });
      if (r.ok) expect(r.notes[0]).toMatch(/AI check failed/);
    });
  });

  describe("Case F: unsupported content never reaches a parser", () => {
    it("rejects a PNG labelled as PDF before any parsing", async () => {
      const aiExtract = vi.fn();
      const r = await run(png, "application/pdf", aiExtract);
      expect(r).toMatchObject({ ok: false, code: "content_mismatch" });
      expect(aiExtract).not.toHaveBeenCalled();
    });

    it("rejects empty files", async () => {
      expect(await run(new Uint8Array(), "application/pdf")).toMatchObject({ ok: false, code: "empty_file" });
    });
  });

  describe("images", () => {
    it("does not claim success for images when AI is not configured", async () => {
      const r = await run(png, "image/png");
      expect(r).toMatchObject({ ok: false, code: "image_needs_ai", retryable: false });
    });

    it("offers a retry when the AI provider fails", async () => {
      const r = await run(png, "image/png", async () => {
        throw new AiProviderError("server", "x");
      });
      expect(r).toMatchObject({ ok: false, code: "ai_failed", retryable: true });
    });

    it("reports an unreadable image instead of an empty success", async () => {
      const r = await run(png, "image/png", async () => ({
        blocks: [],
        timezone: "Asia/Kolkata",
        notes: "Image is too blurry.",
      }));
      expect(r).toMatchObject({ ok: false, code: "nothing_found" });
      if (!r.ok) expect(r.message).toMatch(/blurry/);
    });

    it("flags low-confidence and invalid AI rows for correction", async () => {
      const r = await run(png, "image/png", async () => ({
        blocks: [
          { weekday: 1, startTime: "09:00", endTime: "10:00", label: "Maths", confidence: 0.95 },
          { weekday: 2, startTime: "11:00", endTime: "10:00", label: "Lab", confidence: 0.9 },
          { weekday: 3, startTime: "14:00", endTime: "15:00", label: null, confidence: 0.4 },
        ],
        timezone: "Asia/Kolkata",
        notes: null,
      }));
      expect(r).toMatchObject({ ok: true, method: "ai", completeness: "partial" });
      if (r.ok) {
        expect(r.drafts[1]).toMatchObject({ startTime: null, endTime: null });
        expect(r.drafts[2].uncertainties.join(" ")).toMatch(/not sure/);
        expect(r.drafts.every((d) => !d.confirmed)).toBe(true);
      }
    });
  });
});
