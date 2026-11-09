import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** One real request to MET Norway. Opt-in only (LIVE_WEATHER=1): CI never calls live services. */
describe.skipIf(process.env.LIVE_WEATHER !== "1")("MET Norway (live)", () => {
  it("returns hourly Hyderabad conditions with attribution", async () => {
    const { getForecast } = await import("@/features/conditions/providers");
    const f = await getForecast(17.385, 78.4867, Date.now());
    expect(f).toMatchObject({ source: "met_norway", live: true, attribution: "Data from MET Norway" });
    expect(f!.hours.length).toBeGreaterThanOrEqual(24);
    expect(f!.hours[0].tempC).toBeGreaterThan(0);
  });
});
