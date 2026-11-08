// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/csp-report/route";
import { formatViolation, stripUrl } from "@/lib/security/csp-report";

function report(body: string, contentType = "application/csp-report") {
  return new Request("http://x/api/v1/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

const LEGACY = {
  "csp-report": {
    "document-uri": "https://hydrunners.vercel.app/workouts?token=secret#frag",
    "blocked-uri": "https://evil.example/x.js?session=abc",
    "effective-directive": "script-src-elem",
    disposition: "report",
    "original-policy": "default-src 'self'",
  },
};

afterEach(() => vi.restoreAllMocks());

describe("POST /api/v1/csp-report", () => {
  it("logs one compact line without query strings or fragments and returns 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await POST(report(JSON.stringify(LEGACY)));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toBe(
      "[csp-violation] directive=script-src-elem disposition=report blocked=https://evil.example/x.js document=https://hydrunners.vercel.app/workouts",
    );
    expect(line).not.toMatch(/secret|session|frag|\n/);
  });

  it("accepts Reporting API batches and ignores other report types", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = [
      {
        type: "csp-violation",
        url: "https://hydrunners.vercel.app/map",
        body: {
          documentURL: "https://hydrunners.vercel.app/map?x=1",
          blockedURL: "inline",
          effectiveDirective: "style-src-attr",
          disposition: "report",
        },
      },
      { type: "deprecation", body: { id: "x" } },
    ];
    const res = await POST(report(JSON.stringify(body), "application/reports+json"));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("blocked=inline document=https://hydrunners.vercel.app/map");
  });

  it("rejects other content types with 415", async () => {
    const res = await POST(report(JSON.stringify(LEGACY), "application/json"));
    expect(res.status).toBe(415);
  });

  it("rejects bodies over 8 KB with 413, by declared or actual size", async () => {
    const big = JSON.stringify({ "csp-report": { "document-uri": "https://x/" + "a".repeat(9000) } });
    expect((await POST(report(big))).status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const chunked = new Request("http://x/api/v1/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(chunked)).status).toBe(413);
  });

  it("rejects invalid JSON and wrong shapes with 400", async () => {
    expect((await POST(report("{not json"))).status).toBe(400);
    expect((await POST(report(JSON.stringify({ hello: "world" })))).status).toBe(400);
    expect((await POST(report(JSON.stringify({ a: 1 }), "application/reports+json"))).status).toBe(400);
  });

  it("never throws, even if logging fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await POST(report(JSON.stringify(LEGACY)));
    expect(res.status).toBe(204);
  });
});

describe("CSP report sanitising", () => {
  it("reduces URLs to origin and path, and non-http schemes to the scheme", () => {
    expect(stripUrl("https://a.example/p?q=1#f")).toBe("https://a.example/p");
    expect(stripUrl("data:image/png;base64,AAAA")).toBe("data");
    expect(stripUrl("blob:https://a.example/uuid")).toBe("blob");
    expect(stripUrl("eval")).toBe("eval");
    expect(stripUrl("weird value?x=1")).toBe("weirdvalue");
    expect(stripUrl(undefined)).toBeUndefined();
  });

  it("keeps log lines single-line even with hostile values", () => {
    const line = formatViolation({ directive: "script-src\nFAKE LOG", blocked: "inline\r\nX", document: "x" });
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("directive=script-srcFAKELOG");
  });
});
