import { z } from "zod";
import { EventExtras } from "@/features/events/logic";
import { Announcement, AnnouncementAudience, EventStatus, LocationKind } from "@/lib/contracts";
import { localDateTimeToIso } from "./dates";

export const AnnouncementDraft = z.object({
  title: z.string().trim().min(1, "Add a title.").max(120),
  body: z.string().trim().min(1, "Write the announcement.").max(5000),
  audience: AnnouncementAudience,
  audienceId: z.uuid().nullable(),
  publishAt: z.iso.datetime({ offset: true }),
});

export const AnnouncementView = Announcement.extend({
  readAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AnnouncementView = z.infer<typeof AnnouncementView>;

export const LocationUpdateDraft = z.object({
  locationId: z.uuid(),
  title: z.string().trim().min(1, "Add a title.").max(120),
  body: z.string().trim().min(1, "Write the update.").max(2000),
  publishAt: z.iso.datetime({ offset: true }),
});

export const LocationUpdate = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  authorId: z.uuid(),
  title: z.string(),
  body: z.string(),
  publishAt: z.iso.datetime({ offset: true }),
});
export type LocationUpdate = z.infer<typeof LocationUpdate>;

export const EventDraft = z
  .object({
    title: z.string().trim().min(1, "Add a title.").max(120),
    description: z.string().trim().max(5000),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    locationId: z.uuid().nullable(),
    capacity: z.number().int().positive().nullable(),
    status: EventStatus,
  })
  .refine((event) => event.endsAt > event.startsAt, {
    message: "The end must be after the start.",
    path: ["endsAt"],
  });

export const DirectMessageDraft = z.object({
  recipientId: z.uuid(),
  body: z.string().trim().min(1, "Write a message.").max(2000),
});

export const DirectMessage = z.object({
  id: z.uuid(),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type DirectMessage = z.infer<typeof DirectMessage>;

export const LocationDraft = z.object({
  name: z.string().trim().min(1).max(120),
  kind: LocationKind,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().trim().max(200).nullable(),
  verified: z.boolean(),
});

function firstIssue(error: z.ZodError) {
  return { ok: false as const, message: error.issues[0]?.message ?? "Some fields are missing or invalid." };
}

function publishAt(formData: FormData) {
  const raw = formData.get("publishAt");
  if (typeof raw !== "string" || raw === "") return new Date().toISOString();
  return localDateTimeToIso(raw);
}

export function parseAnnouncementForm(formData: FormData) {
  const audienceId = formData.get("audienceId");
  const parsed = AnnouncementDraft.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    audience: formData.get("audience"),
    audienceId: typeof audienceId === "string" && audienceId !== "" ? audienceId : null,
    publishAt: publishAt(formData),
  });
  if (!parsed.success) return firstIssue(parsed.error);
  if (parsed.data.publishAt === null) return { ok: false as const, message: "Enter a valid publish time." };
  return { ok: true as const, data: parsed.data };
}

export function parseLocationUpdateForm(formData: FormData) {
  const parsed = LocationUpdateDraft.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    body: formData.get("body"),
    publishAt: publishAt(formData),
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export function parseEventForm(formData: FormData) {
  const closesRaw = String(formData.get("registrationClosesAt") ?? "");
  const extras = EventExtras.safeParse({
    category: formData.get("category") ?? "group_run",
    meetingPoint: formData.get("meetingPoint") ?? "",
    registrationClosesAt: closesRaw ? localDateTimeToIso(closesRaw) : null,
  });
  if (!extras.success) return firstIssue(extras.error);
  const starts = localDateTimeToIso(String(formData.get("startsAt") ?? ""));
  const ends = localDateTimeToIso(String(formData.get("endsAt") ?? ""));
  const capacityRaw = formData.get("capacity");
  const locationId = formData.get("locationId");
  const parsed = EventDraft.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    startsAt: starts,
    endsAt: ends,
    locationId: typeof locationId === "string" && locationId !== "" ? locationId : null,
    capacity: capacityRaw === null || capacityRaw === "" ? null : Number(capacityRaw),
    status: formData.get("status"),
  });
  if (!parsed.success) return firstIssue(parsed.error);
  if (extras.data.registrationClosesAt && extras.data.registrationClosesAt > parsed.data.endsAt) {
    return { ok: false as const, message: "Registration must close before the event ends." };
  }
  return { ok: true as const, data: { ...parsed.data, ...extras.data } };
}

export function parseMessageForm(formData: FormData) {
  const parsed = DirectMessageDraft.safeParse({
    recipientId: formData.get("recipientId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}

export function parseLocationForm(formData: FormData) {
  const parsed = LocationDraft.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind") || "other",
    latitude: Number(formData.get("latitude")),
    longitude: Number(formData.get("longitude")),
    address: formData.get("address") ? String(formData.get("address")).trim() : null,
    verified: formData.get("verified") === "yes",
  });
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true as const, data: parsed.data };
}
