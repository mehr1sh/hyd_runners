import { z } from "zod";

export const WEEKDAY_LABEL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** ISO weekday (1 = Monday) → "Saturday". */
export function weekdayName(isoDay: number) {
  return WEEKDAY_LABEL[(isoDay - 1 + 7) % 7];
}

/** "06:00:00" → "6:00 am". */
export function formatLocalTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const SeriesDraft = z.object({
  clubId: z.uuid().nullable(),
  title: z.string().trim().min(3, "Name the run.").max(120),
  description: z.string().trim().max(2000),
  locationId: z.uuid().nullable(),
  meetingPoint: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v)),
  weekday: z.number().int().min(1, "Choose a day.").max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a start time."),
  durationMinutes: z.number().int().min(15).max(360),
  capacity: z.number().int().positive().nullable(),
  beginnerFriendly: z.boolean(),
  noDrop: z.boolean(),
  regroupPolicy: z.string().trim().min(1, "Describe how the group regroups.").max(300),
});
export type SeriesDraft = z.infer<typeof SeriesDraft>;

export function parseSeriesForm(formData: FormData) {
  const opt = (k: string) => {
    const v = String(formData.get(k) ?? "");
    return v === "" ? null : v;
  };
  const capacity = opt("capacity");
  const parsed = SeriesDraft.safeParse({
    clubId: opt("clubId"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    locationId: opt("locationId"),
    meetingPoint: formData.get("meetingPoint") ?? "",
    weekday: Number(formData.get("weekday")),
    startTime: formData.get("startTime"),
    durationMinutes: Number(formData.get("durationMinutes") ?? 60),
    capacity: capacity === null ? null : Number(capacity),
    beginnerFriendly: formData.get("beginnerFriendly") === "on",
    noDrop: formData.get("noDrop") === "on",
    regroupPolicy: formData.get("regroupPolicy") ?? "",
  });
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the form." };
  return { ok: true as const, data: parsed.data };
}
