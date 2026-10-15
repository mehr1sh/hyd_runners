import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, ok, parseJson } from "@/lib/api/response";

describe("API envelope helpers", () => {
  it("wraps data in { data }", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { hello: "world" } });
  });

  it("returns { error } with the mapped status", async () => {
    const res = fail("not_found", "Nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Nope" } });
  });

  it("returns 422 for bodies that fail the schema", async () => {
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ n: "x" }) });
    const result = await parseJson(req, z.object({ n: z.number() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(422);
  });
});
