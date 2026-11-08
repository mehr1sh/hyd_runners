import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/contracts";
import { CommunityEvent, Location } from "@/lib/contracts";
import { dbFailure, type ServiceResult } from "@/features/shared/db";
import { isMissingSchemaError } from "@/lib/supabase/errors";
import { canManageCommunity, hasAnyRole, MANAGER_ROLES } from "./logic/access";
import { AnnouncementView, LocationUpdate, type DirectMessage } from "./logic/content";
import { isUnread } from "./logic/dates";
import { ParticipationFeedback, barrierToTarget, type FeedbackDraft } from "./logic/feedback";
import { reportedTargetIds } from "./moderation";

export const FEEDBACK_LIMIT = 100;
export const MESSAGE_LIMIT = 200;
export const LIST_LIMIT = 100;
const ASSIGNMENT_LIMIT = 100;

function iso(value: string) {
  return new Date(value).toISOString();
}

async function rolesOf(supabase: SupabaseClient, userId: string): Promise<ServiceResult<Role[]>> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return dbFailure(error, "Could not check your role.");
  return { ok: true, data: (data ?? []).map((row) => row.role as Role) };
}

async function requireManager(supabase: SupabaseClient, userId: string) {
  const roles = await rolesOf(supabase, userId);
  if (!roles.ok) return roles;
  if (!canManageCommunity(roles.data)) {
    return { ok: false as const, code: "forbidden" as const, message: "Programme managers only." };
  }
  return { ok: true as const, data: roles.data };
}

export async function submitFeedback(supabase: SupabaseClient, userId: string, input: FeedbackDraft) {
  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: userId,
      target: barrierToTarget(input.barrier),
      target_id: null,
      rating: input.rating,
      body: input.body,
      barrier: input.barrier,
      status: "new",
      assigned_to: null,
    })
    .select("*")
    .single();
  if (error) return dbFailure(error, "Could not save your feedback.");
  return { ok: true as const, data: mapFeedback(data) };
}

type ReplyRow = {
  id: string;
  feedback_id: string;
  author_id: string;
  body: string;
  created_at: string;
  hidden_at?: string | null;
};
type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  hidden_at?: string | null;
};

async function readReplies(supabase: SupabaseClient, feedbackIds: string[]) {
  const read = (columns: string) =>
    supabase
      .from("feedback_replies")
      .select(columns)
      .in("feedback_id", feedbackIds)
      .order("created_at", { ascending: true });
  let result = await read("id, feedback_id, author_id, body, created_at, hidden_at");
  // hidden_at arrives with the moderation migration; read without it until then.
  if (result.error && isMissingSchemaError(result.error))
    result = await read("id, feedback_id, author_id, body, created_at");
  return { data: (result.data ?? []) as unknown as ReplyRow[], error: result.error };
}

export async function listFeedback(supabase: SupabaseClient, userId: string) {
  // Newest FEEDBACK_LIMIT items (RLS scopes them to the viewer).
  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_LIMIT);
  if (error) return dbFailure(error, "Could not load feedback.");
  const rows = data ?? [];
  const ids = rows.map((row) => row.id as string);
  const replies = ids.length ? await readReplies(supabase, ids) : { data: [] as ReplyRow[], error: null };
  if (replies.error) return dbFailure(replies.error, "Could not load replies.");

  const names = await displayNames(supabase, [
    ...rows.flatMap((row) => [row.user_id, row.assigned_to].filter(Boolean)),
    ...(replies.data ?? []).map((row) => row.author_id),
  ] as string[]);
  const reportedReplies = await reportedTargetIds(
    supabase,
    userId,
    "feedback_reply",
    (replies.data ?? []).map((reply) => reply.id as string),
  );
  const reportedFeedback = await reportedTargetIds(supabase, userId, "feedback", ids);

  return {
    ok: true as const,
    data: rows.map((row) => ({
      ...mapFeedback(row),
      authorName: names.get(row.user_id) ?? "Runner",
      assigneeName: row.assigned_to ? (names.get(row.assigned_to) ?? "Staff") : null,
      reported: reportedFeedback.has(row.id as string),
      replies: (replies.data ?? [])
        .filter((reply) => reply.feedback_id === row.id)
        .map((reply) => ({
          id: reply.id as string,
          authorId: reply.author_id as string,
          authorName: names.get(reply.author_id) ?? "Member",
          // Hidden by a moderator: the text is not sent to the browser.
          body: reply.hidden_at ? null : (reply.body as string),
          hidden: Boolean(reply.hidden_at),
          reported: reportedReplies.has(reply.id as string),
          createdAt: iso(reply.created_at),
        })),
    })),
    viewerId: userId,
  };
}

function mapFeedback(row: {
  id: string;
  user_id: string;
  target: string;
  target_id: string | null;
  rating: number | null;
  body: string;
  status: string;
  barrier: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}) {
  return ParticipationFeedback.parse({
    id: row.id,
    userId: row.user_id,
    target: row.target,
    targetId: row.target_id,
    rating: row.rating,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
    barrier: row.barrier,
    assignedTo: row.assigned_to,
    updatedAt: iso(row.updated_at),
  });
}

async function displayNames(supabase: SupabaseClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  for (const row of data ?? []) names.set(row.id, row.display_name);
  return names;
}

export async function replyToFeedback(supabase: SupabaseClient, userId: string, feedbackId: string, body: string) {
  const { error } = await supabase.from("feedback_replies").insert({
    feedback_id: feedbackId,
    author_id: userId,
    body,
  });
  if (error) return dbFailure(error, "Could not send that reply.");
  return { ok: true as const, data: null };
}

export async function updateFeedback(
  supabase: SupabaseClient,
  userId: string,
  feedbackId: string,
  patch: { assignedTo?: string; status?: "new" | "acknowledged" | "resolved" },
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const row: { assigned_to?: string; status?: string } = {};
  if (patch.assignedTo) row.assigned_to = patch.assignedTo;
  if (patch.status) row.status = patch.status;
  if (!row.assigned_to && !row.status) {
    return { ok: false as const, code: "validation_failed" as const, message: "Choose a status or a coach." };
  }
  const { error } = await supabase.from("feedback").update(row).eq("id", feedbackId);
  if (error) return dbFailure(error, "Could not update that feedback.");
  return { ok: true as const, data: null };
}

export async function listAnnouncements(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("announcements")
    .select("id, author_id, audience, audience_id, title, body, publish_at")
    .order("publish_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return dbFailure(error, "Could not load announcements.");
  const ids = (data ?? []).map((row) => row.id as string);
  const reads = ids.length
    ? await supabase
        .from("announcement_reads")
        .select("announcement_id, read_at")
        .eq("user_id", userId)
        .in("announcement_id", ids)
    : { data: [], error: null };
  if (reads.error) return dbFailure(reads.error, "Could not load read status.");
  const readAt = new Map((reads.data ?? []).map((row) => [row.announcement_id as string, iso(row.read_at)]));
  const now = Date.now();
  const views = (data ?? []).map((row) => {
    const publishedAt = iso(row.publish_at);
    const readTime = readAt.get(row.id) ?? null;
    return {
      ...AnnouncementView.parse({
        id: row.id,
        authorId: row.author_id,
        audience: row.audience,
        audienceId: row.audience_id,
        title: row.title,
        body: row.body,
        publishAt: publishedAt,
        readAt: readTime,
      }),
      unread: isUnread(publishedAt, readTime, now),
      scheduled: new Date(publishedAt).getTime() > now,
    };
  });
  return { ok: true as const, data: views };
}

export async function saveAnnouncement(
  supabase: SupabaseClient,
  userId: string,
  input: {
    id?: string;
    title: string;
    body: string;
    audience: "everyone" | "programme" | "coach_group";
    audienceId: string | null;
    publishAt: string;
  },
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  if (input.id) {
    const { error } = await supabase
      .from("announcements")
      .update({
        title: input.title,
        body: input.body,
        audience: input.audience,
        audience_id: input.audienceId,
        publish_at: input.publishAt,
      })
      .eq("id", input.id);
    if (error) return dbFailure(error, "Could not update the announcement.");
    return { ok: true as const, data: null };
  }
  const { error } = await supabase.from("announcements").insert({
    author_id: userId,
    title: input.title,
    body: input.body,
    audience: input.audience,
    audience_id: input.audienceId,
    publish_at: input.publishAt,
  });
  if (error) return dbFailure(error, "Could not publish the announcement.");
  return { ok: true as const, data: null };
}

export async function markAnnouncementRead(supabase: SupabaseClient, userId: string, announcementId: string) {
  const { error } = await supabase.from("announcement_reads").insert({
    user_id: userId,
    announcement_id: announcementId,
  });
  if (error && error.code !== "23505") return dbFailure(error, "Could not mark that announcement as read.");
  return { ok: true as const, data: null };
}

export async function listLocationUpdates(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("location_updates")
    .select("id, location_id, author_id, title, body, publish_at")
    .order("publish_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return dbFailure(error, "Could not load location updates.");
  return {
    ok: true as const,
    data: (data ?? []).map((row) =>
      LocationUpdate.parse({
        id: row.id,
        locationId: row.location_id,
        authorId: row.author_id,
        title: row.title,
        body: row.body,
        publishAt: iso(row.publish_at),
      }),
    ),
  };
}

export async function saveLocationUpdate(
  supabase: SupabaseClient,
  userId: string,
  input: { id?: string; locationId: string; title: string; body: string; publishAt: string },
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  if (input.id) {
    const { error } = await supabase
      .from("location_updates")
      .update({
        location_id: input.locationId,
        title: input.title,
        body: input.body,
        publish_at: input.publishAt,
      })
      .eq("id", input.id);
    if (error) return dbFailure(error, "Could not update that notice.");
    return { ok: true as const, data: null };
  }
  const { error } = await supabase.from("location_updates").insert({
    author_id: userId,
    location_id: input.locationId,
    title: input.title,
    body: input.body,
    publish_at: input.publishAt,
  });
  if (error) return dbFailure(error, "Could not publish that notice.");
  return { ok: true as const, data: null };
}

export async function saveLocation(
  supabase: SupabaseClient,
  userId: string,
  input: {
    id?: string;
    name: string;
    kind: string;
    latitude: number;
    longitude: number;
    address: string | null;
    verified: boolean;
  },
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const row = {
    name: input.name,
    kind: input.kind,
    latitude: input.latitude,
    longitude: input.longitude,
    address: input.address,
    verified: input.verified,
  };
  const { error } = input.id
    ? await supabase.from("locations").update(row).eq("id", input.id)
    : await supabase.from("locations").insert({ ...row, created_by: userId });
  if (error) return dbFailure(error, "Could not save that location.");
  return { ok: true as const, data: null };
}

export async function listManagedEvents(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("events")
    .select("id, title, description, starts_at, ends_at, location_id, capacity, status, created_by")
    // Upcoming events and those of the last 30 days; older ones are history.
    .gte("ends_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(LIST_LIMIT);
  if (error) return dbFailure(error, "Could not load events.");
  return {
    ok: true as const,
    data: (data ?? []).map((row) =>
      CommunityEvent.parse({
        id: row.id,
        title: row.title,
        description: row.description,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        locationId: row.location_id,
        capacity: row.capacity,
        status: row.status,
        createdBy: row.created_by,
      }),
    ),
  };
}

export async function saveEvent(
  supabase: SupabaseClient,
  userId: string,
  input: {
    id?: string;
    title: string;
    description: string;
    startsAt: string;
    endsAt: string;
    locationId: string | null;
    capacity: number | null;
    status: "draft" | "published" | "cancelled";
  },
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const row = {
    title: input.title,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    location_id: input.locationId,
    capacity: input.capacity,
    status: input.status,
  };
  const { error } = input.id
    ? await supabase.from("events").update(row).eq("id", input.id)
    : await supabase.from("events").insert({ ...row, created_by: userId });
  if (error) return dbFailure(error, "Could not save that event.");
  return { ok: true as const, data: null };
}

export async function listMessages(supabase: SupabaseClient, userId: string) {
  const read = (columns: string) =>
    supabase.from("messages").select(columns).order("created_at", { ascending: false }).limit(MESSAGE_LIMIT);
  let { data, error } = await read("id, sender_id, recipient_id, body, created_at, hidden_at");
  // hidden_at arrives with the moderation migration; read without it until then.
  if (error && isMissingSchemaError(error))
    ({ data, error } = await read("id, sender_id, recipient_id, body, created_at"));
  if (error) return dbFailure(error, "Could not load messages.");
  // Newest MESSAGE_LIMIT, shown oldest first.
  const rows = [...((data ?? []) as unknown as MessageRow[])].reverse().map((row) => ({
    ...({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      body: row.body,
      createdAt: iso(row.created_at),
    } satisfies DirectMessage),
    hidden: Boolean(row.hidden_at),
  }));
  const reported = await reportedTargetIds(
    supabase,
    userId,
    "message",
    rows.filter((row) => row.recipientId === userId).map((row) => row.id),
  );
  const names = await displayNames(
    supabase,
    rows.flatMap((row) => [row.senderId, row.recipientId]),
  );
  return {
    ok: true as const,
    data: rows.map((row) => ({
      ...row,
      // Hidden by a moderator: the text is not sent to the browser.
      body: row.hidden ? null : row.body,
      reported: reported.has(row.id),
      senderName: names.get(row.senderId) ?? "Member",
      recipientName: names.get(row.recipientId) ?? "Member",
    })),
    viewerId: userId,
  };
}

export async function listRecipients(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("list_message_recipients");
  if (error) return dbFailure(error, "Could not load people you can message.");
  const seen = new Map<string, { id: string; displayName: string; roles: string[] }>();
  for (const row of data ?? []) {
    const current = seen.get(row.id) ?? { id: row.id as string, displayName: row.display_name as string, roles: [] };
    current.roles.push(row.role as string);
    seen.set(row.id, current);
  }
  return { ok: true as const, data: [...seen.values()] };
}

export async function sendMessage(supabase: SupabaseClient, userId: string, recipientId: string, body: string) {
  const { error } = await supabase.from("messages").insert({
    sender_id: userId,
    recipient_id: recipientId,
    body,
  });
  if (error) return dbFailure(error, "Could not send that message.");
  return { ok: true as const, data: null };
}

export const PEOPLE_PAGE_SIZE = 25;

/**
 * One page of people (optionally filtered by name) with their roles, every
 * coach/mentor/manager for the assignment form, and the newest assignments.
 * Paged so the manager area keeps working past the API's 1000-row cap.
 */
export async function listPeople(
  supabase: SupabaseClient,
  userId: string,
  options: { query?: string; page?: number } = {},
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const query = (options.query ?? "").trim().slice(0, 60);

  let profilesQuery = supabase
    .from("profiles")
    .select("id, display_name", { count: "exact" })
    .order("display_name")
    .order("id")
    .range(page * PEOPLE_PAGE_SIZE, page * PEOPLE_PAGE_SIZE + PEOPLE_PAGE_SIZE - 1);
  // PostgREST pattern: escape the LIKE wildcards the user typed.
  if (query) profilesQuery = profilesQuery.ilike("display_name", `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const [profiles, staffRoles, assignments] = await Promise.all([
    profilesQuery,
    supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["coach", "mentor", "programme_manager", "admin"])
      .limit(1000),
    supabase
      .from("coach_assignments")
      .select("id, coach_id, runner_id, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(ASSIGNMENT_LIMIT),
  ]);
  if (profiles.error) return dbFailure(profiles.error, "Could not load people.");
  if (staffRoles.error) return dbFailure(staffRoles.error, "Could not load roles.");
  if (assignments.error) return dbFailure(assignments.error, "Could not load assignments.");

  const pageIds = (profiles.data ?? []).map((p) => p.id as string);
  const pageRoles = pageIds.length
    ? await supabase.from("user_roles").select("user_id, role").in("user_id", pageIds)
    : { data: [], error: null };
  if (pageRoles.error) return dbFailure(pageRoles.error, "Could not load roles.");

  const rolesOf = (rows: { user_id: string; role: string }[]) => {
    const map = new Map<string, Role[]>();
    for (const row of rows) map.set(row.user_id, [...(map.get(row.user_id) ?? []), row.role as Role]);
    return map;
  };
  const pageRoleMap = rolesOf(pageRoles.data ?? []);
  const staffRoleMap = rolesOf(staffRoles.data ?? []);
  const names = await displayNames(supabase, [
    ...staffRoleMap.keys(),
    ...(assignments.data ?? []).flatMap((a) => [a.coach_id as string, a.runner_id as string]),
  ]);

  return {
    ok: true as const,
    data: {
      people: (profiles.data ?? []).map((profile) => ({
        id: profile.id as string,
        displayName: profile.display_name as string,
        roles: pageRoleMap.get(profile.id) ?? [],
      })),
      total: profiles.count ?? 0,
      page,
      pageSize: PEOPLE_PAGE_SIZE,
      query,
      staff: [...staffRoleMap.entries()]
        .map(([id, roles]) => ({ id, displayName: names.get(id) ?? "Member", roles }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      assignments: (assignments.data ?? []).map((row) => ({
        id: row.id as string,
        coachId: row.coach_id as string,
        runnerId: row.runner_id as string,
        coachName: names.get(row.coach_id) ?? "Member",
        runnerName: names.get(row.runner_id) ?? "Member",
      })),
      assignmentsTotal: assignments.count ?? 0,
    },
  };
}

export async function grantStaffRole(
  supabase: SupabaseClient,
  userId: string,
  targetId: string,
  role: "coach" | "mentor",
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  if (targetId === userId && !hasAnyRole(manager.data, MANAGER_ROLES)) {
    return { ok: false as const, code: "forbidden" as const, message: "You cannot change your own role here." };
  }
  const { error } = await supabase.from("user_roles").insert({
    user_id: targetId,
    role,
    granted_by: userId,
  });
  if (error) return dbFailure(error, "Could not grant that role.");
  return { ok: true as const, data: null };
}

export async function revokeStaffRole(
  supabase: SupabaseClient,
  userId: string,
  targetId: string,
  role: "coach" | "mentor",
) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const { error } = await supabase.from("user_roles").delete().eq("user_id", targetId).eq("role", role);
  if (error) return dbFailure(error, "Could not remove that role.");
  return { ok: true as const, data: null };
}

export async function assignCoach(supabase: SupabaseClient, userId: string, coachId: string, runnerId: string) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const { error } = await supabase.from("coach_assignments").insert({
    coach_id: coachId,
    runner_id: runnerId,
    assigned_by: userId,
  });
  if (error) return dbFailure(error, "Could not assign that coach.");
  return { ok: true as const, data: null };
}

export async function removeAssignment(supabase: SupabaseClient, userId: string, assignmentId: string) {
  const manager = await requireManager(supabase, userId);
  if (!manager.ok) return manager;
  const { error } = await supabase.from("coach_assignments").delete().eq("id", assignmentId);
  if (error) return dbFailure(error, "Could not remove that assignment.");
  return { ok: true as const, data: null };
}

export async function listLocations(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, kind, latitude, longitude, address, verified")
    .order("name")
    .limit(500);
  if (error) return dbFailure(error, "Could not load locations.");
  return {
    ok: true as const,
    data: (data ?? []).map((row) =>
      Location.parse({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) }),
    ),
  };
}
