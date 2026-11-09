import { FitBaseType as B, FitEncoder } from "fit-file-parser/encoder";

/** Points every `stepS` seconds heading north at `speedMs`, optional elevation/HR. */
export function track(opts: {
  start?: Date;
  seconds: number;
  speedMs: number;
  stepS?: number;
  lat0?: number;
  lon0?: number;
  ele?: (i: number) => number | null;
  hr?: number | null;
}) {
  const start = opts.start ?? new Date("2026-11-01T00:30:00Z");
  const step = opts.stepS ?? 5;
  const lat0 = opts.lat0 ?? 17.42;
  const lon0 = opts.lon0 ?? 78.42;
  const metresPerDegLat = 111_195;
  const pts = [];
  for (let s = 0, i = 0; s <= opts.seconds; s += step, i++) {
    pts.push({
      t: new Date(start.getTime() + s * 1000),
      lat: lat0 + (opts.speedMs * s) / metresPerDegLat,
      lon: lon0,
      ele: opts.ele ? opts.ele(i) : null,
      hr: opts.hr ?? null,
    });
  }
  return pts;
}

export function gpx(points: ReturnType<typeof track>, extra = "") {
  const body = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.ele !== null ? `<ele>${p.ele}</ele>` : ""}<time>${p.t.toISOString()}</time>${
          p.hr
            ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
            : ""
        }</trkpt>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test"><trk><name>Test run</name>${extra}<trkseg>${body}</trkseg></trk></gpx>`;
}

const semi = (deg: number) => Math.round(deg * (2 ** 31 / 180));

/** A real FIT activity file (file_id, records, session) built with the encoder. */
export function fit(points: ReturnType<typeof track>, opts: { sport?: number; timerSeconds?: number } = {}) {
  const e = new FitEncoder();
  e.writeMessage(0, [
    { number: 0, size: 1, baseType: B.Enum, value: 4 },
    { number: 4, size: 4, baseType: B.Uint32, value: FitEncoder.toFitTimestamp(points[0].t) },
  ]);
  for (const p of points) {
    const fields = [
      { number: 253, size: 4, baseType: B.Uint32, value: FitEncoder.toFitTimestamp(p.t) },
      { number: 0, size: 4, baseType: B.Sint32, value: semi(p.lat) },
      { number: 1, size: 4, baseType: B.Sint32, value: semi(p.lon) },
    ];
    if (p.ele !== null) fields.push({ number: 2, size: 2, baseType: B.Uint16, value: Math.round((p.ele + 500) * 5) });
    if (p.hr) fields.push({ number: 3, size: 1, baseType: B.Uint8, value: p.hr });
    e.writeMessage(20, fields);
  }
  const elapsed = (points[points.length - 1].t.getTime() - points[0].t.getTime()) / 1000;
  e.writeMessage(18, [
    { number: 2, size: 4, baseType: B.Uint32, value: FitEncoder.toFitTimestamp(points[0].t) },
    { number: 5, size: 1, baseType: B.Enum, value: opts.sport ?? 1 },
    { number: 7, size: 4, baseType: B.Uint32, value: Math.round(elapsed * 1000) },
    { number: 8, size: 4, baseType: B.Uint32, value: Math.round((opts.timerSeconds ?? elapsed) * 1000) },
  ]);
  return e.close();
}
