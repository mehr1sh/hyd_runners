import { z } from "zod";

/** Mirrors the events.category check constraint. */
export const EVENT_CATEGORY_LABEL = {
  group_run: "Group run",
  beginner: "Beginner friendly",
  race: "Race",
  training: "Training session",
  social: "Social run",
  workshop: "Workshop",
} as const;
export type EventCategory = keyof typeof EVENT_CATEGORY_LABEL;
const CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL) as [EventCategory, ...EventCategory[]];

export const TEAM_ROLE_LABEL = {
  organiser: "Organiser",
  captain: "Run captain",
  sweeper: "Sweeper",
  volunteer: "Volunteer",
} as const;
export type TeamRole = keyof typeof TEAM_ROLE_LABEL;

export type RsvpStatus = "going" | "waitlisted" | "cancelled";

/** List filters from the URL. Unknown values fall back to the defaults. */
export function parseEventFilters(sp: Record<string, string | string[] | undefined>) {
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
  const when = one("when") === "past" ? ("past" as const) : ("upcoming" as const);
  const category = z.enum(CATEGORIES).safeParse(one("category"));
  const location = z.uuid().safeParse(one("location"));
  const before = z.iso.datetime({ offset: true }).safeParse(one("before"));
  const after = z.iso.datetime({ offset: true }).safeParse(one("after"));
  return {
    when,
    category: category.success ? category.data : null,
    locationId: location.success ? location.data : null,
    // Cursor: the start time of the last event shown.
    cursor: when === "past" ? (before.success ? before.data : null) : after.success ? after.data : null,
  };
}
export type EventFilters = ReturnType<typeof parseEventFilters>;

export function filterHref(
  filters: EventFilters,
  patch: Partial<Omit<EventFilters, "cursor">> & { cursor?: string | null },
) {
  const next = { ...filters, cursor: null, ...patch };
  const params = new URLSearchParams();
  if (next.when === "past") params.set("when", "past");
  if (next.category) params.set("category", next.category);
  if (next.locationId) params.set("location", next.locationId);
  if (next.cursor) params.set(next.when === "past" ? "before" : "after", next.cursor);
  const query = params.toString();
  return query ? `/events?${query}` : "/events";
}

/** 330 → "5:30". */
export function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "5:30" → 330; empty → null; anything else → NaN (invalid). */
export function parsePace(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function paceRangeLabel(min: number | null, max: number | null, runWalk: boolean) {
  if (runWalk) return "Run-walk";
  if (min !== null && max !== null) return `${formatPace(min)}–${formatPace(max)} min/km`;
  if (min !== null) return `${formatPace(min)} min/km and slower`;
  if (max !== null) return `Up to ${formatPace(max)} min/km`;
  return "Any pace";
}

/** 1745 → "29:05"; 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "29:05" or "1:02:05" → seconds; invalid → NaN. */
export function parseDuration(value: string) {
  const match = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Whole days, hours and minutes until `start`, or null once it has started. */
export function countdown(nowMs: number, startIso: string) {
  const diff = new Date(startIso).getTime() - nowMs;
  if (diff <= 0) return null;
  const minutes = Math.floor(diff / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

export function countdownLabel(parts: { days: number; hours: number; minutes: number } | null) {
  if (!parts) return null;
  if (parts.days > 0) return `Starts in ${parts.days} day${parts.days === 1 ? "" : "s"}, ${parts.hours} h`;
  if (parts.hours > 0) return `Starts in ${parts.hours} h ${parts.minutes} min`;
  return `Starts in ${parts.minutes} min`;
}

function icsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}
function icsDate(iso: string) {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

/** A single-event iCalendar file. */
export function buildIcs(input: {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  url: string;
  now?: Date;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HYD Runners//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.id}@hydrunners`,
    `DTSTAMP:${icsDate((input.now ?? new Date()).toISOString())}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${icsText(input.title)}`,
    `DESCRIPTION:${icsText(`${input.description}${input.description ? "\n\n" : ""}${input.url}`)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    `URL:${input.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- forms

function firstIssue(error: z.ZodError) {
  return { ok: false as const, message: error.issues[0]?.message ?? "Some fields are missing or invalid." };
}

export const PaceGroupDraft = z
  .object({
    eventId: z.uuid(),
    label: z.string().trim().min(1, "Name the pace group.").max(60),
    minPace: z.number().int().min(120).max(1200).nullable(),
    maxPace: z.number().int().min(120).max(1200).nullable(),
    runWalk: z.boolean(),
    notes: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((g) => g.minPace === null || g.maxPace === null || g.minPace < g.maxPace, {
    message: "The faster pace must come first, e.g. 5:30 to 6:00.",
    path: ["maxPace"],
  });

export function parsePaceGroupForm(formData: FormData) {
  const min = parsePace(String(formData.get("minPace") ?? ""));
  const max = parsePace(String(formData.get("maxPace") ?? ""));
  if (Number.isNaN(min) || Number.isNaN(max)) return { ok: false as const, message: "Write paces as m:ss, e.g. 5:30." };
  const parsed = PaceGroupDraft.safeParse({
    eventId: formData.get("eventId"),
    label: formData.get("label"),
    minPace: min,
    maxPace: max,
    runWalk: formData.get("runWalk") === "on",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export const ResultDraft = z
  .object({
    eventId: z.uuid(),
    userId: z.uuid(),
    outcome: z.enum(["finished", "dnf", "dns"]),
    finishSeconds: z.number().int().min(60).max(86_400).nullable(),
  })
  .refine((r) => r.finishSeconds === null || r.outcome === "finished", {
    message: "Only finishers have a time.",
    path: ["finishSeconds"],
  });

export function parseResultForm(formData: FormData) {
  const raw = String(formData.get("finishTime") ?? "").trim();
  const seconds = raw === "" ? null : parseDuration(raw);
  if (seconds !== null && Number.isNaN(seconds))
    return { ok: false as const, message: "Write the time as mm:ss or h:mm:ss." };
  const parsed = ResultDraft.safeParse({
    eventId: formData.get("eventId"),
    userId: formData.get("userId"),
    outcome: formData.get("outcome"),
    finishSeconds: seconds,
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export const EventExtras = z.object({
  category: z.enum(CATEGORIES, "Choose a category."),
  meetingPoint: z
    .string()
    .trim()
    .max(200, "Keep the meeting point under 200 characters.")
    .transform((v) => (v === "" ? null : v)),
  registrationClosesAt: z.iso.datetime({ offset: true }).nullable(),
});
