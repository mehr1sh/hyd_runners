import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  fetchStreams,
  importableType,
  listActivities,
  needsRefresh,
  refreshTokens,
  StravaError,
  streamsToParsed,
} from "@/features/integrations/strava";
import { providers } from "@/features/integrations/providers";

const cfg = {
  clientId: "123",
  clientSecret: "secret-value",
  redirectUri: "https://hydrunners.example/api/integrations/strava/callback",
};
const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Strava OAuth", () => {
  it("asks only for read access to activities", () => {
    const u = new URL(authorizeUrl(cfg, "state-1"));
    expect(u.searchParams.get("scope")).toBe("activity:read");
    expect(u.searchParams.get("state")).toBe("state-1");
    expect(u.toString()).not.toContain("secret");
  });
  it("refuses a grant without activity access", async () => {
    await expect(exchangeCode(cfg, "code", "read", json({}) as unknown as typeof fetch)).rejects.toBeInstanceOf(
      StravaError,
    );
  });
  it("exchanges and refreshes tokens", async () => {
    const f = json({
      access_token: "a".repeat(20),
      refresh_token: "r".repeat(20),
      expires_at: 2_000_000_000,
      athlete: { id: 7 },
    });
    const t = await exchangeCode(cfg, "code", "read,activity:read", f as unknown as typeof fetch);
    expect(t).toMatchObject({ athleteId: 7, expiresAt: 2_000_000_000 });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ grant_type: "authorization_code", client_id: "123" });
    await refreshTokens(cfg, "r".repeat(20), f as unknown as typeof fetch);
    expect(needsRefresh({ expiresAt: 1000 }, 999_000)).toBe(true);
    expect(needsRefresh({ expiresAt: 100_000 }, 0)).toBe(false);
  });
  it("maps errors", async () => {
    await expect(listActivities("tok", 0, 1, json({}, 429) as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "rate_limited",
    });
    await expect(listActivities("tok", 0, 1, json({}, 401) as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "auth",
    });
  });
});

describe("Strava activity mapping", () => {
  const summary = {
    id: 9,
    name: "Morning Run",
    sport_type: "Run",
    start_date: "2026-11-01T00:30:00Z",
    elapsed_time: 1900,
    moving_time: 1800,
    distance: 5000,
  };
  it("imports runs, walks and hikes only", () => {
    expect(importableType("Run")).toBe("run");
    expect(importableType("Hike")).toBe("hike");
    expect(importableType("Ride")).toBeNull();
  });
  it("turns streams into samples for the shared import pipeline", async () => {
    const f = json({
      time: { data: [0, 10, 20] },
      latlng: {
        data: [
          [17.4, 78.4],
          [17.4001, 78.4001],
          [17.4002, 78.4002],
        ],
      },
      altitude: { data: [500, 501, 502] },
      heartrate: { data: [120, 130, 140] },
    });
    const streams = await fetchStreams("tok", 9, f as unknown as typeof fetch);
    const parsed = streamsToParsed(summary, streams);
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.samples[1]).toMatchObject({
      t: Date.parse("2026-11-01T00:30:10Z"),
      lat: 17.4001,
      hr: 130,
      cadence: null,
    });
    expect(parsed).toMatchObject({ detectedType: "run", deviceMovingSeconds: 1800, name: "Morning Run" });
  });
});

describe("provider status", () => {
  it("never reports Strava or the app as available", () => {
    const list = providers({ stravaConfigured: false });
    expect(list.find((p) => p.key === "file_export")?.status).toBe("available");
    expect(list.filter((p) => p.status === "available").map((p) => p.key)).toEqual(["file_export"]);
    expect(list.find((p) => p.key === "strava")?.requirement).toMatch(/approval/);
  });
});
