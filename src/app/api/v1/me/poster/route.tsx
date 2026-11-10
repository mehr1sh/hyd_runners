import { ImageResponse } from "next/og";
import { fail } from "@/lib/api/response";
import { internalError, requireCaller } from "@/features/scheduler/server/api";
import { routeSvgPath } from "@/features/share/logic";
import { MONTHS } from "@/features/storytelling/logic";

/**
 * GET /api/v1/me/poster?month=YYYY-MM&theme=neon|classic: the caller's monthly
 * training poster (PNG). Owner only; real totals and privacy-trimmed routes.
 */
export async function GET(request: Request) {
  const auth = await requireCaller(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("validation_failed", "Use month=YYYY-MM.");
  const neon = params.get("theme") === "neon";
  const [y, m] = month.split("-").map(Number);
  const from = new Date(`${month}-01T00:00:00+05:30`).toISOString();
  const to = new Date(
    `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+05:30`,
  ).toISOString();
  let rows: unknown[];
  try {
    const { data, error } = await auth.caller.supabase
      .from("activities")
      .select("started_at, distance_m, moving_seconds, activity_public_geojson")
      .eq("user_id", auth.caller.user.id)
      .eq("status", "ready")
      .gte("started_at", from)
      .lt("started_at", to)
      .order("started_at")
      .limit(200);
    if (error) throw error;
    rows = data ?? [];
  } catch (error) {
    return internalError("monthly poster", error, "Could not create the poster.");
  }
  {
    const acts = rows as {
      started_at: string;
      distance_m: number;
      moving_seconds: number;
      activity_public_geojson: { coordinates: [number, number][] } | null;
    }[];
    const km = acts.reduce((s, a) => s + Number(a.distance_m), 0) / 1000;
    const secs = acts.reduce((s, a) => s + Number(a.moving_seconds), 0);
    const days = new Set(acts.map((a) => new Date(Date.parse(a.started_at) + 330 * 60_000).toISOString().slice(0, 10)))
      .size;
    const routes = acts
      .map((a) => a.activity_public_geojson?.coordinates ?? null)
      .filter((c): c is [number, number][] => Boolean(c && c.length > 1))
      .slice(0, 12);
    const bg = neon ? "#0b0f1a" : "#f7f7f5";
    const fg = neon ? "#f4f6fb" : "#2c335a";
    const line = neon ? "#39ff88" : "#e31e25";
    const stat = (label: string, value: string) => (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 30, opacity: 0.7 }}>{label}</div>
        <div style={{ fontSize: 72, fontWeight: 700 }}>{value}</div>
      </div>
    );
    return new ImageResponse(
      <div
        style={{
          width: 1080,
          height: 1350,
          display: "flex",
          flexDirection: "column",
          backgroundColor: bg,
          color: fg,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 4, fontWeight: 700 }}>HYD RUNNERS</div>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700, marginTop: 32 }}>{`${MONTHS[m - 1]} ${y}`}</div>
        <div style={{ display: "flex", gap: 56, marginTop: 40 }}>
          {stat("Distance", `${km.toFixed(1)} km`)}
          {stat("Activities", String(acts.length))}
          {stat("Active days", String(days))}
        </div>
        <div
          style={{ display: "flex", fontSize: 30, opacity: 0.7, marginTop: 16 }}
        >{`${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min moving`}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 48 }}>
          {routes.map((c, i) => (
            <svg key={i} width={204} height={204} viewBox="0 0 204 204" style={{ display: "flex" }}>
              <path
                d={routeSvgPath(c, 204, 204, 12) ?? ""}
                fill="none"
                stroke={line}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, opacity: 0.7 }}>
          {acts.length === 0 ? "No activities this month." : "Routes are privacy-trimmed. hydrunners.vercel.app"}
        </div>
      </div>,
      { width: 1080, height: 1350, headers: { "cache-control": "private, no-store" } },
    );
  }
}
