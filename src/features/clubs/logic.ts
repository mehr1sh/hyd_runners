import { z } from "zod";

export const JOIN_POLICY_LABEL = {
  open: "Open: anyone can join",
  request: "Ask to join: a club admin or captain approves",
  invite: "Invite only: join with an invite link",
} as const;
export const JOIN_POLICY_SHORT = { open: "Open", request: "Ask to join", invite: "Invite only" } as const;
export type JoinPolicy = keyof typeof JOIN_POLICY_LABEL;

export const CLUB_ROLE_LABEL = { admin: "Club admin", captain: "Captain", member: "Member" } as const;
export type ClubRole = keyof typeof CLUB_ROLE_LABEL;

/** "KBR Dawn Runners!" → "kbr-dawn-runners". */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const ClubDraft = z.object({
  name: z.string().trim().min(2, "Name the club.").max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.")
    .min(3, "The web address needs at least 3 characters.")
    .max(60),
  description: z.string().trim().max(2000),
  area: optional(80),
  homeLocationId: z.uuid().nullable(),
  joinPolicy: z.enum(["open", "request", "invite"]),
});
export type ClubDraft = z.infer<typeof ClubDraft>;

export function parseClubForm(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const slugRaw = String(formData.get("slug") ?? "").trim();
  const home = String(formData.get("homeLocationId") ?? "");
  const parsed = ClubDraft.safeParse({
    name,
    slug: slugRaw || slugify(name),
    description: formData.get("description") ?? "",
    area: formData.get("area") ?? "",
    homeLocationId: home === "" ? null : home,
    joinPolicy: formData.get("joinPolicy") ?? "request",
  });
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the form." };
  return { ok: true as const, data: parsed.data };
}

export const InviteDraft = z.object({
  clubId: z.uuid(),
  days: z.number().int().min(1, "Invites last at least a day.").max(90, "Invites last at most 90 days."),
  maxUses: z.number().int().min(1).max(1000),
});

export function inviteUrl(siteUrl: string, code: string) {
  return `${siteUrl.replace(/\/$/, "")}/clubs/join/${code}`;
}
