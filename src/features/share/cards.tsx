import "server-only";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { PR_DISTANCES, type PrKey } from "@/features/activities/logic/normalize";
import { ACTIVITY_TYPE_LABEL, duration, km, pace } from "@/features/activities/logic/format";
import { formatDuration } from "@/features/events/logic";
import { CARD_FORMATS, cardDate, routeSvgPath, type CardOptions } from "./logic";

const NAVY = "#2c335a";
const RED = "#e31e25";
const OFF_WHITE = "#f7f5f2";

export type ActivityCardData = {
  type: keyof typeof ACTIVITY_TYPE_LABEL;
  name: string | null;
  startedAt: string | null;
  distanceM: number | null;
  movingSeconds: number | null;
  avgPace: number | null;
  elevationGain: number | null;
  publicPath: [number, number][] | null;
  bestEfforts: Partial<Record<PrKey, number>>;
};

export type ChallengeCardData = {
  title: string;
  goalLabel: string;
  completedAt: string;
  scopeLabel: string;
  rewardXp: number;
};

function Frame({ o, children }: { o: CardOptions; children: ReactElement | ReactElement[] }) {
  const { width, height } = CARD_FORMATS[o.format];
  const pad = o.format === "wide" ? 48 : 72;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: OFF_WHITE,
        color: NAVY,
        padding: pad,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: RED, display: "flex" }} />
        <div style={{ fontSize: o.format === "wide" ? 28 : 36, fontWeight: 700, letterSpacing: 4 }}>HYD RUNNERS</div>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: big ? 280 : 220 }}>
      <div style={{ fontSize: big ? 34 : 26, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: big ? 84 : 56, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export function activityCard(a: ActivityCardData, o: CardOptions) {
  const { width } = CARD_FORMATS[o.format];
  const wide = o.format === "wide";
  const big = o.format !== "wide";
  const mapW = wide ? 460 : width - 144;
  const mapH = wide ? 460 : o.format === "story" ? 820 : 400;
  const path = o.showRoute ? routeSvgPath(a.publicPath, mapW, mapH, 24) : null;
  const best = PR_DISTANCES.filter((d) => a.bestEfforts[d.key] !== undefined).at(-1);
  const stats = [
    { label: "Distance", value: km(a.distanceM) },
    { label: "Moving time", value: duration(a.movingSeconds) },
    ...(o.showPace && a.type !== "walk" && a.type !== "hike" ? [{ label: "Pace", value: pace(a.avgPace) }] : []),
    ...(a.elevationGain !== null ? [{ label: "Elevation gain", value: `${Math.round(a.elevationGain)} m` }] : []),
  ];
  const title = a.name?.trim() || ACTIVITY_TYPE_LABEL[a.type];
  const heading = (
    <div style={{ display: "flex", flexDirection: "column", marginTop: wide ? 24 : 48 }}>
      <div style={{ fontSize: wide ? 44 : 64, fontWeight: 700, lineHeight: 1.1 }}>{title.slice(0, 60)}</div>
      <div style={{ fontSize: wide ? 26 : 34, opacity: 0.7, marginTop: 8 }}>
        {`${ACTIVITY_TYPE_LABEL[a.type]} · ${cardDate(a.startedAt)}`}
      </div>
    </div>
  );
  const map = path ? (
    <svg width={mapW} height={mapH} viewBox={`0 0 ${mapW} ${mapH}`} style={{ display: "flex" }}>
      <path
        d={path}
        fill="none"
        stroke={RED}
        strokeWidth={wide ? 8 : 12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : null;
  const statBlock = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: big ? 40 : 24, marginTop: wide ? 24 : 40 }}>
      {stats.map((s) => (
        <Stat key={s.label} label={s.label} value={s.value} big={big} />
      ))}
    </div>
  );
  const footer = (
    <div
      style={{ display: "flex", flexDirection: "column", marginTop: "auto", fontSize: wide ? 20 : 26, opacity: 0.7 }}
    >
      {best && o.showPace && a.type !== "walk" && a.type !== "hike" ? (
        <div style={{ display: "flex" }}>
          {`Best ${best.label} in this activity: ${formatDuration(a.bestEfforts[best.key]!)} (GPS measured, not an official result)`}
        </div>
      ) : (
        <div style={{ display: "flex" }} />
      )}
      <div style={{ display: "flex" }}>hydrunners.vercel.app</div>
    </div>
  );
  if (wide) {
    return (
      <Frame o={o}>
        <div style={{ display: "flex", flex: 1, gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {heading}
            {statBlock}
            {footer}
          </div>
          {map ?? <div style={{ display: "flex" }} />}
        </div>
      </Frame>
    );
  }
  return (
    <Frame o={o}>
      {heading}
      {map ? <div style={{ display: "flex", marginTop: 40 }}>{map}</div> : <div style={{ display: "flex" }} />}
      {statBlock}
      {footer}
    </Frame>
  );
}

export function challengeCard(c: ChallengeCardData, o: CardOptions) {
  const wide = o.format === "wide";
  return (
    <Frame o={o}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: wide ? 30 : 40, color: RED, fontWeight: 700, letterSpacing: 2 }}>
          CHALLENGE COMPLETE
        </div>
        <div style={{ fontSize: wide ? 56 : 84, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>
          {c.title.slice(0, 80)}
        </div>
        <div style={{ fontSize: wide ? 32 : 44, marginTop: 24 }}>{c.goalLabel}</div>
        <div style={{ fontSize: wide ? 26 : 34, opacity: 0.7, marginTop: 16 }}>
          {`${c.scopeLabel} · completed ${cardDate(c.completedAt)}${c.rewardXp > 0 ? ` · +${c.rewardXp} XP` : ""}`}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: wide ? 20 : 26, opacity: 0.7 }}>hydrunners.vercel.app</div>
    </Frame>
  );
}

export function renderCard(element: ReactElement, o: CardOptions, filename: string) {
  const { width, height } = CARD_FORMATS[o.format];
  return new ImageResponse(element, {
    width,
    height,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${filename}.png"`,
    },
  });
}
