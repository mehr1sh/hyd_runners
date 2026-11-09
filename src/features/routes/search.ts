/**
 * Route search: typed filters, URL (de)serialisation, and a constrained
 * natural-language parser.
 *
 * The parser is deterministic and rule-based (no model, no external service).
 * It can only ever produce values from the whitelists below, which are passed
 * as typed parameters to `search_routes()`. Words it does not understand stay
 * as plain search text, which the database matches as data.
 */

export const SURFACES = ["road", "track", "trail", "mixed"] as const;
export const TERRAINS = ["flat", "rolling", "hilly"] as const;
export const DIFFICULTIES = ["easy", "moderate", "hard"] as const;
export const LIGHTINGS = ["lit", "partly_lit", "unlit"] as const;
export const SHADES = ["good", "some", "little"] as const;
export const SORTS = ["relevance", "nearest", "distance_asc", "distance_desc", "rating", "name"] as const;
export type Sort = (typeof SORTS)[number];

export type Place = { id: string; name: string; lat: number; lon: number };

export type SearchFilters = {
  text: string | null;
  placeId: string | null;
  radiusKm: number;
  minKm: number | null;
  maxKm: number | null;
  surface: string[];
  terrain: string[];
  difficulty: string[];
  lighting: string[];
  shade: string[];
  loop: boolean;
  beginner: boolean;
  verified: boolean;
  water: boolean;
  toilets: boolean;
  minRating: number | null;
  noReports: boolean;
  sort: Sort;
};

export const EMPTY_FILTERS: SearchFilters = {
  text: null,
  placeId: null,
  radiusKm: 5,
  minKm: null,
  maxKm: null,
  surface: [],
  terrain: [],
  difficulty: [],
  lighting: [],
  shade: [],
  loop: false,
  beginner: false,
  verified: false,
  water: false,
  toilets: false,
  minRating: null,
  noReports: false,
  sort: "relevance",
};

type SP = Record<string, string | string[] | undefined>;
const all = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[]) : sp[k] ? [sp[k] as string] : []);
const one = (sp: SP, k: string) => all(sp, k)[0];
const pick = <T extends string>(values: string[], allowed: readonly T[]) =>
  [...new Set(values.flatMap((v) => v.split(",")))].filter((v): v is T => (allowed as readonly string[]).includes(v));
const num = (v: string | undefined, lo: number, hi: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Structured filters from the URL. Anything outside the whitelists is dropped. */
export function filtersFromParams(sp: SP): SearchFilters {
  const text = (one(sp, "text") ?? "").trim().slice(0, 200);
  const place = one(sp, "place");
  let minKm = num(one(sp, "min"), 0, 100);
  let maxKm = num(one(sp, "max"), 0, 100);
  if (minKm !== null && maxKm !== null && minKm > maxKm) [minKm, maxKm] = [maxKm, minKm];
  const sort = one(sp, "sort");
  return {
    text: text || null,
    placeId: place && UUID.test(place) ? place : null,
    radiusKm: num(one(sp, "radius"), 0.5, 50) ?? 5,
    minKm,
    maxKm,
    surface: pick(all(sp, "surface"), SURFACES),
    terrain: pick(all(sp, "terrain"), TERRAINS),
    difficulty: pick(all(sp, "difficulty"), DIFFICULTIES),
    lighting: pick(all(sp, "lighting"), LIGHTINGS),
    shade: pick(all(sp, "shade"), SHADES),
    loop: one(sp, "loop") === "1",
    beginner: one(sp, "beginner") === "1",
    verified: one(sp, "verified") === "1",
    water: one(sp, "water") === "1",
    toilets: one(sp, "toilets") === "1",
    minRating: num(one(sp, "rating"), 1, 5),
    noReports: one(sp, "noreports") === "1",
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "relevance",
  };
}

export function filtersToParams(f: SearchFilters) {
  const p = new URLSearchParams();
  if (f.text) p.set("text", f.text);
  if (f.placeId) {
    p.set("place", f.placeId);
    if (f.radiusKm !== 5) p.set("radius", String(f.radiusKm));
  }
  if (f.minKm !== null) p.set("min", String(f.minKm));
  if (f.maxKm !== null) p.set("max", String(f.maxKm));
  for (const k of ["surface", "terrain", "difficulty", "lighting", "shade"] as const)
    for (const v of f[k]) p.append(k, v);
  for (const [k, on] of [
    ["loop", f.loop],
    ["beginner", f.beginner],
    ["verified", f.verified],
    ["water", f.water],
    ["toilets", f.toilets],
    ["noreports", f.noReports],
  ] as const)
    if (on) p.set(k, "1");
  if (f.minRating !== null) p.set("rating", String(f.minRating));
  if (f.sort !== "relevance") p.set("sort", f.sort);
  return p;
}

export function searchHref(f: SearchFilters) {
  const q = filtersToParams(f).toString();
  return q ? `/routes?${q}` : "/routes";
}

export function isFiltered(f: SearchFilters) {
  return filtersToParams({ ...f, sort: "relevance" }).toString() !== "";
}

// ---------------------------------------------------------------------------
// Natural-language parsing
// ---------------------------------------------------------------------------

type Rule = { re: RegExp; apply: (f: SearchFilters) => void };
const add = (k: "surface" | "terrain" | "difficulty" | "lighting" | "shade", v: string) => (f: SearchFilters) => {
  if (!f[k].includes(v)) f[k] = [...f[k], v];
};
const KEYWORDS: Rule[] = [
  { re: /\b(flat|level)\b/, apply: add("terrain", "flat") },
  { re: /\b(rolling|undulating)\b/, apply: add("terrain", "rolling") },
  { re: /\b(hilly|hills?|climbs?|elevation)\b/, apply: add("terrain", "hilly") },
  { re: /\b(easy|gentle|relaxed)\b/, apply: add("difficulty", "easy") },
  { re: /\b(moderate)\b/, apply: add("difficulty", "moderate") },
  { re: /\b(hard|tough|difficult|challenging)\b/, apply: add("difficulty", "hard") },
  { re: /\b(trails?|off[- ]?road|dirt)\b/, apply: add("surface", "trail") },
  { re: /\b(roads?|tarmac|paved)\b/, apply: add("surface", "road") },
  { re: /\b(running track|track|stadium)\b/, apply: add("surface", "track") },
  { re: /\b(well[- ]?lit|lit|lights?|street ?lights?|night|evening)\b/, apply: add("lighting", "lit") },
  { re: /\b(shaded?|shady|trees?)\b/, apply: add("shade", "good") },
  { re: /\b(loops?|circular|round trip)\b/, apply: (f) => void (f.loop = true) },
  {
    re: /\b(beginner[- ]friendly|beginners?|newbies?|first[- ]?timers?|couch to 5k|c25k)\b/,
    apply: (f) => void (f.beginner = true),
  },
  { re: /\b(verified)\b/, apply: (f) => void (f.verified = true) },
  { re: /\b(water|refill|drinking)\b/, apply: (f) => void (f.water = true) },
  { re: /\b(toilets?|washrooms?|restrooms?|bathrooms?|loos?)\b/, apply: (f) => void (f.toilets = true) },
  {
    re: /\b(top[- ]rated|best[- ]rated|highly[- ]rated|best)\b/,
    apply: (f) => {
      f.minRating = 4;
      f.sort = "rating";
    },
  },
  {
    re: /\b(no (hazards?|closures?|reports?|issues?)|safe right now)\b/,
    apply: (f) => void (f.noReports = true),
  },
];

const STOPWORDS = new Set(
  "a an the and or with for to of on at in near around by close from i me my we want need looking find show some any route routes run runs running jog jogging place places good nice that is are which something please".split(
    " ",
  ),
);

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`\s*(k|km|kms|kilometres?|kilometers?|mi|miles?)\b`;
const toKm = (n: string, unit: string) => Number(n) * (unit.startsWith("m") ? 1.609344 : 1);
const round1 = (n: number) => Math.round(n * 10) / 10;

export type ParsedQuery = { filters: SearchFilters; understood: string[] };

/**
 * Turns "flat 5k loop near KBR Park with lights" into typed filters plus a list
 * of what was understood (shown to the runner so nothing happens silently).
 */
export function parseRouteQuery(input: string, places: Place[]): ParsedQuery {
  const f: SearchFilters = { ...EMPTY_FILTERS, surface: [], terrain: [], difficulty: [], lighting: [], shade: [] };
  const understood: string[] = [];
  let s = ` ${input.toLowerCase().slice(0, 200).replace(/\s+/g, " ")} `;

  // Distances: ranges first, then bounds, then a single target (±15%).
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`(?:between|from)?\s*${NUM}\s*(?:-|to|and)\s*${NUM}${UNIT}`).exec(s))) {
    const a = toKm(m[1], m[3]);
    const b = toKm(m[2], m[3]);
    f.minKm = round1(Math.min(a, b));
    f.maxKm = round1(Math.max(a, b));
    understood.push(`${f.minKm}–${f.maxKm} km`);
    s = s.replace(m[0], " ");
  } else {
    if (
      (m = new RegExp(
        String.raw`(?:under|below|less than|shorter than|up to|at most|max(?:imum)?)\s*${NUM}${UNIT}`,
      ).exec(s))
    ) {
      f.maxKm = round1(toKm(m[1], m[2]));
      understood.push(`up to ${f.maxKm} km`);
      s = s.replace(m[0], " ");
    }
    if (
      (m = new RegExp(String.raw`(?:over|above|more than|longer than|at least|min(?:imum)?)\s*${NUM}${UNIT}`).exec(s))
    ) {
      f.minKm = round1(toKm(m[1], m[2]));
      understood.push(`at least ${f.minKm} km`);
      s = s.replace(m[0], " ");
    }
    if (f.minKm === null && f.maxKm === null) {
      let target: number | null = null;
      if ((m = /\bhalf[- ]?marathon\b/.exec(s))) target = 21.1;
      else if ((m = /\bmarathon\b/.exec(s))) target = 42.2;
      else if ((m = new RegExp(String.raw`(?:about|around|roughly|~)?\s*${NUM}${UNIT}`).exec(s)))
        target = toKm(m[1], m[2]);
      if (m && target !== null && target > 0 && target <= 100) {
        f.minKm = round1(target * 0.85);
        f.maxKm = round1(target * 1.15);
        understood.push(`about ${round1(target)} km (${f.minKm}–${f.maxKm})`);
        s = s.replace(m[0], " ");
      }
    }
  }
  if (f.minKm !== null && f.minKm > 100) f.minKm = 100;
  if (f.maxKm !== null && f.maxKm > 100) f.maxKm = 100;

  // Places: the longest known place name mentioned anywhere.
  const place = [...places]
    .sort((a, b) => b.name.length - a.name.length)
    .find((p) => p.name.trim().length >= 3 && s.includes(` ${p.name.toLowerCase().trim()} `.replace(/\s+/g, " ")));
  if (place) {
    f.placeId = place.id;
    understood.push(`near ${place.name}`);
    s = s.replace(` ${place.name.toLowerCase().trim()} `.replace(/\s+/g, " "), " ");
  }

  for (const rule of KEYWORDS) {
    const hit = rule.re.exec(s);
    if (!hit) continue;
    rule.apply(f);
    s = s.replace(new RegExp(rule.re.source, "g"), " ");
  }
  if (f.terrain.length) understood.push(f.terrain.join(" or "));
  if (f.difficulty.length) understood.push(f.difficulty.join(" or "));
  if (f.surface.length) understood.push(f.surface.join(" or "));
  if (f.lighting.length) understood.push("lit");
  if (f.shade.length) understood.push("good shade");
  if (f.loop) understood.push("loop");
  if (f.beginner) understood.push("suits beginners");
  if (f.verified) understood.push("verified");
  if (f.water) understood.push("water refill");
  if (f.toilets) understood.push("toilets");
  if (f.minRating !== null) understood.push(`rated ${f.minRating}★ or more`);
  if (f.noReports) understood.push("no open condition reports");

  const rest = s
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+(\.\d+)?$/.test(w));
  if (rest.length) {
    f.text = rest.join(" ");
    understood.push(`matching “${f.text}”`);
  }
  if (f.placeId && f.sort === "relevance" && !f.text) f.sort = "nearest";
  return { filters: f, understood };
}

const LABELS: Record<string, string> = {
  road: "Road",
  track: "Running track",
  trail: "Trail",
  mixed: "Mixed surface",
  flat: "Flat",
  rolling: "Rolling",
  hilly: "Hilly",
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  lit: "Lit",
  partly_lit: "Partly lit",
  unlit: "Not lit",
  good: "Good shade",
  some: "Some shade",
  little: "Little shade",
};
export const valueLabel = (v: string) => LABELS[v] ?? v;

/** One removable chip per active filter; `without` is the filter set minus that chip. */
export function filterChips(f: SearchFilters, placeName: string | null) {
  const chips: { key: string; label: string; without: SearchFilters }[] = [];
  const push = (key: string, label: string, without: Partial<SearchFilters>) =>
    chips.push({ key, label, without: { ...f, ...without } });
  if (f.text) push("text", `“${f.text}”`, { text: null });
  if (f.placeId)
    push("place", `Within ${f.radiusKm} km of ${placeName ?? "the chosen place"}`, {
      placeId: null,
      sort: f.sort === "nearest" ? "relevance" : f.sort,
    });
  if (f.minKm !== null && f.maxKm !== null) push("dist", `${f.minKm}–${f.maxKm} km`, { minKm: null, maxKm: null });
  else if (f.minKm !== null) push("dist", `At least ${f.minKm} km`, { minKm: null });
  else if (f.maxKm !== null) push("dist", `Up to ${f.maxKm} km`, { maxKm: null });
  for (const k of ["surface", "terrain", "difficulty", "lighting", "shade"] as const)
    for (const v of f[k]) push(`${k}:${v}`, valueLabel(v), { [k]: f[k].filter((x) => x !== v) });
  if (f.loop) push("loop", "Loop", { loop: false });
  if (f.beginner) push("beginner", "Suits beginners", { beginner: false });
  if (f.verified) push("verified", "Verified on the ground", { verified: false });
  if (f.water) push("water", "Water refill", { water: false });
  if (f.toilets) push("toilets", "Toilets", { toilets: false });
  if (f.minRating !== null) push("rating", `Rated ${f.minRating}★ or more`, { minRating: null });
  if (f.noReports) push("noreports", "No open condition reports", { noReports: false });
  return chips;
}
