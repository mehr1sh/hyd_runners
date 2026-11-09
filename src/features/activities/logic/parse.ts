import FitParser from "fit-file-parser";
import { ActivityValidationError, type ActivityType, type ParsedActivity, type RawSample } from "./normalize";

export const MAX_ACTIVITY_FILE_BYTES = 15 * 1024 * 1024;
const MAX_POINTS = 200_000;

/** Which parser a file needs, judged by its content (never by name or MIME type alone). */
export function sniffFormat(bytes: Uint8Array): "fit" | "gpx" | null {
  // FIT: header size 12 or 14, ".FIT" signature at bytes 8–11.
  if (
    bytes.length >= 12 &&
    (bytes[0] === 12 || bytes[0] === 14) &&
    String.fromCharCode(...bytes.slice(8, 12)) === ".FIT"
  ) {
    return "fit";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<gpx[\s>]/i.test(head)) return "gpx";
  return null;
}

function typeFromText(value: string | null | undefined): ActivityType | null {
  const v = (value ?? "").toLowerCase();
  if (/walk[\s_-]*run|run[\s_-]*walk/.test(v)) return "walk_run";
  if (/run|jog|trail/.test(v)) return "run";
  if (/hik/.test(v)) return "hike";
  if (/walk/.test(v)) return "walk";
  return null;
}

/** GPX 1.0/1.1 track points with times (rtept as a fallback). */
export function parseActivityGpx(xml: string): ParsedActivity {
  if (!/<gpx[\s>]/i.test(xml)) throw new ActivityValidationError("That file is not a GPX file.");
  if (/<!ENTITY/i.test(xml))
    throw new ActivityValidationError("That GPX file contains unsupported entity declarations.");
  const tag = /<trkpt\b/i.test(xml) ? "trkpt" : "rtept";
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, "gi");
  const samples: RawSample[] = [];
  for (const m of xml.matchAll(re)) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    const time = /<time>\s*([^<]+?)\s*<\/time>/i.exec(body)?.[1];
    const t = time ? Date.parse(time) : Number.NaN;
    if (time && Number.isNaN(t)) throw new ActivityValidationError("The GPX file has a malformed timestamp.");
    const num = (r: RegExp) => {
      const v = r.exec(body)?.[1];
      const n = v === undefined ? Number.NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    samples.push({
      t,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      ele: num(/<ele>\s*([-\d.]+)\s*<\/ele>/i),
      dist: null,
      hr: num(/<(?:\w+:)?hr>\s*(\d+)\s*<\/(?:\w+:)?hr>/i),
      cadence: num(/<(?:\w+:)?cad>\s*(\d+)\s*<\/(?:\w+:)?cad>/i),
    });
    if (samples.length > MAX_POINTS) throw new ActivityValidationError("The track has too many points.");
  }
  if (samples.length === 0) throw new ActivityValidationError("The GPX file has no track points.");
  if (samples.every((s) => Number.isNaN(s.t))) {
    throw new ActivityValidationError(
      "The GPX file has no timestamps, so pace and duration cannot be calculated. To share a route without times, use Routes instead.",
    );
  }
  if (samples.some((s) => s.lat !== null && (Math.abs(s.lat) > 90 || Math.abs(s.lon ?? 0) > 180))) {
    throw new ActivityValidationError("The GPX file has invalid coordinates.");
  }
  const name = /<trk>[\s\S]*?<name>\s*([^<]{1,120}?)\s*<\/name>/i.exec(xml)?.[1] ?? null;
  const type = /<trk>[\s\S]*?<type>\s*([^<]{1,60}?)\s*<\/type>/i.exec(xml)?.[1] ?? null;
  return {
    format: "gpx",
    samples: samples.filter((s) => !Number.isNaN(s.t)),
    detectedType: typeFromText(type),
    deviceMovingSeconds: null,
    name,
  };
}

const FIT_SPORTS: Record<string, ActivityType> = { running: "run", walking: "walk", hiking: "hike" };

export async function parseActivityFit(bytes: Uint8Array): Promise<ParsedActivity> {
  let data: Awaited<ReturnType<FitParser["parseAsync"]>>;
  try {
    // force: false verifies the file's CRCs, so corrupted files are rejected.
    data = await new FitParser({ force: false, speedUnit: "m/s", lengthUnit: "m", mode: "list" }).parseAsync(
      Buffer.from(bytes),
    );
  } catch {
    throw new ActivityValidationError("That FIT file is corrupted or not a FIT activity.");
  }
  const d = data as unknown as {
    records?: Record<string, unknown>[];
    sessions?: Record<string, unknown>[];
  };
  const records = d.records ?? [];
  if (records.length > MAX_POINTS) throw new ActivityValidationError("The activity has too many points.");
  const session = d.sessions?.[0];
  const sport = typeof session?.sport === "string" ? session.sport : null;
  if (sport && !FIT_SPORTS[sport] && !["generic", "training", "fitness_equipment"].includes(sport)) {
    throw new ActivityValidationError(
      `HYD Runners imports runs, walks and hikes. This file is a ${sport.replaceAll("_", " ")} activity.`,
    );
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const samples: RawSample[] = records.map((r) => ({
    t: r.timestamp instanceof Date ? r.timestamp.getTime() : Date.parse(String(r.timestamp)),
    lat: num(r.position_lat),
    lon: num(r.position_long),
    ele: num(r.enhanced_altitude) ?? num(r.altitude),
    dist: num(r.distance),
    hr: num(r.heart_rate),
    cadence: num(r.cadence),
  }));
  if (samples.length === 0) throw new ActivityValidationError("The FIT file has no activity records.");
  return {
    format: "fit",
    samples,
    detectedType: sport ? (FIT_SPORTS[sport] ?? null) : null,
    deviceMovingSeconds: num(session?.total_timer_time),
    name: null,
  };
}

export async function parseActivityFile(bytes: Uint8Array): Promise<ParsedActivity> {
  if (bytes.length === 0) throw new ActivityValidationError("The file is empty.");
  if (bytes.length > MAX_ACTIVITY_FILE_BYTES) throw new ActivityValidationError("The file is larger than 15 MB.");
  const format = sniffFormat(bytes);
  if (format === "fit") return parseActivityFit(bytes);
  if (format === "gpx") return parseActivityGpx(new TextDecoder("utf-8").decode(bytes));
  throw new ActivityValidationError("Upload a GPX or FIT activity file.");
}
