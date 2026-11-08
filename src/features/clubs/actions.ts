"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { dbFailure } from "@/features/shared/db";
import { InviteDraft, parseClubForm } from "./logic";

export type ClubFormState = { status: "idle" | "error" | "success"; message?: string };

async function session() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Saving is unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Sign in to continue." };
  return { ok: true as const, user, supabase: await createClient() };
}

function failMsg(error: PostgrestError, fallback: string) {
  // Messages raised by the club rules are written for people; pass them on.
  if (error.code === "23514" || (error.code === "42501" && /club|admin|role|invite/i.test(error.message))) {
    return error.message;
  }
  const failed = dbFailure(error, fallback);
  return failed.ok ? fallback : failed.message;
}

const id = z.uuid();

async function slugOf(supabase: Awaited<ReturnType<typeof createClient>>, clubId: string) {
  const { data } = await supabase.from("clubs").select("slug").eq("id", clubId).maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}
async function refresh(supabase: Awaited<ReturnType<typeof createClient>>, clubId: string) {
  const slug = await slugOf(supabase, clubId);
  revalidatePath("/clubs");
  if (slug) {
    revalidatePath(`/clubs/${slug}`);
    revalidatePath(`/clubs/${slug}/manage`);
  }
}

export async function createClubAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = parseClubForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const c = parsed.data;
  const { data, error } = await current.supabase
    .from("clubs")
    .insert({
      slug: c.slug,
      name: c.name,
      description: c.description,
      area: c.area,
      home_location_id: c.homeLocationId,
      join_policy: c.joinPolicy,
      created_by: current.user.id,
    })
    .select("id, slug")
    .single();
  if (error) {
    const message =
      error.code === "23505"
        ? "That web address is taken. Choose another."
        : error.code === "42501"
          ? "Only programme managers can create clubs."
          : failMsg(error, "Could not create the club.");
    return { status: "error", message };
  }
  // The creator is the first club admin; they can promote members later.
  const { error: adminError } = await current.supabase.rpc("appoint_club_admin", {
    p_club_id: data.id,
    p_user_id: current.user.id,
  });
  if (adminError)
    return { status: "error", message: failMsg(adminError, "The club was created, but the admin could not be set.") };
  revalidatePath("/clubs");
  redirect(`/clubs/${data.slug}/manage`);
}

export async function updateClubAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const parsed = parseClubForm(formData);
  if (!clubId.success) return { status: "error", message: "Club not found." };
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const c = parsed.data;
  const { error, count } = await current.supabase
    .from("clubs")
    .update(
      {
        name: c.name,
        description: c.description,
        area: c.area,
        home_location_id: c.homeLocationId,
        join_policy: c.joinPolicy,
      },
      { count: "exact" },
    )
    .eq("id", clubId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not save the club.") };
  if (count === 0) return { status: "error", message: "Only club admins can edit the club." };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "Club saved." };
}

export async function joinClubAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  if (!clubId.success) return { status: "error", message: "Club not found." };
  const { data, error } = await current.supabase
    .from("club_members")
    .insert({ club_id: clubId.data, user_id: current.user.id })
    .select("status")
    .single();
  if (error) {
    const message =
      error.code === "23505" ? "You have already joined or asked to join." : failMsg(error, "Could not join the club.");
    return { status: "error", message };
  }
  await refresh(current.supabase, clubId.data);
  return {
    status: "success",
    message:
      data.status === "active" ? "Welcome to the club!" : "Request sent. A club admin or captain will review it.",
  };
}

export async function leaveClubAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  if (!clubId.success) return { status: "error", message: "Club not found." };
  const { error } = await current.supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId.data)
    .eq("user_id", current.user.id);
  if (error) return { status: "error", message: failMsg(error, "Could not leave the club.") };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "You have left the club." };
}

export async function decideRequestAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const userId = id.safeParse(formData.get("userId"));
  const approve = formData.get("decision") === "approve";
  if (!clubId.success || !userId.success) return { status: "error", message: "Request not found." };
  const query = approve
    ? current.supabase.from("club_members").update({ status: "active" }, { count: "exact" })
    : current.supabase.from("club_members").delete({ count: "exact" });
  const { error, count } = await query.eq("club_id", clubId.data).eq("user_id", userId.data).eq("status", "pending");
  if (error) return { status: "error", message: failMsg(error, "Could not record the decision.") };
  if (count === 0) return { status: "error", message: "That request was already handled." };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: approve ? "Request approved." : "Request declined." };
}

export async function setMemberRoleAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const userId = id.safeParse(formData.get("userId"));
  const role = z.enum(["admin", "captain", "member"]).safeParse(formData.get("role"));
  if (!clubId.success || !userId.success || !role.success) return { status: "error", message: "Choose a role." };
  const { error, count } = await current.supabase
    .from("club_members")
    .update({ role: role.data }, { count: "exact" })
    .eq("club_id", clubId.data)
    .eq("user_id", userId.data)
    .eq("status", "active");
  if (error) return { status: "error", message: failMsg(error, "Could not change the role.") };
  if (count === 0) return { status: "error", message: "Only club admins change roles." };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "Role updated." };
}

export async function removeMemberAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const userId = id.safeParse(formData.get("userId"));
  if (!clubId.success || !userId.success) return { status: "error", message: "Member not found." };
  const { error, count } = await current.supabase
    .from("club_members")
    .delete({ count: "exact" })
    .eq("club_id", clubId.data)
    .eq("user_id", userId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not remove the member.") };
  if (count === 0) return { status: "error", message: "You can't remove that member." };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "Member removed." };
}

export async function createInviteAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const parsed = InviteDraft.safeParse({
    clubId: formData.get("clubId"),
    days: Number(formData.get("days") ?? 14),
    maxUses: Number(formData.get("maxUses") ?? 50),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const { error } = await current.supabase.from("club_invites").insert({
    club_id: parsed.data.clubId,
    created_by: current.user.id,
    expires_at: new Date(Date.now() + parsed.data.days * 86_400_000).toISOString(),
    max_uses: parsed.data.maxUses,
  });
  if (error) return { status: "error", message: failMsg(error, "Could not create the invite link.") };
  await refresh(current.supabase, parsed.data.clubId);
  return { status: "success", message: "Invite link created." };
}

export async function revokeInviteAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const inviteId = id.safeParse(formData.get("inviteId"));
  if (!clubId.success || !inviteId.success) return { status: "error", message: "Invite not found." };
  const { error, count } = await current.supabase
    .from("club_invites")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", inviteId.data)
    .eq("club_id", clubId.data);
  if (error) return { status: "error", message: failMsg(error, "Could not revoke the invite.") };
  if (count === 0) return { status: "error", message: "Only club admins manage invites." };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "Invite revoked." };
}

export async function postClubAnnouncementAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const clubId = id.safeParse(formData.get("clubId"));
  const title = z.string().trim().min(1, "Add a title.").max(120).safeParse(formData.get("title"));
  const body = z.string().trim().min(1, "Write the announcement.").max(5000).safeParse(formData.get("body"));
  if (!clubId.success) return { status: "error", message: "Club not found." };
  if (!title.success) return { status: "error", message: title.error.issues[0]?.message };
  if (!body.success) return { status: "error", message: body.error.issues[0]?.message };
  const { error } = await current.supabase
    .from("club_announcements")
    .insert({ club_id: clubId.data, author_id: current.user.id, title: title.data, body: body.data });
  if (error) return { status: "error", message: failMsg(error, "Could not post the announcement.") };
  await refresh(current.supabase, clubId.data);
  return { status: "success", message: "Announcement posted." };
}

export async function joinWithInviteAction(_prev: ClubFormState, formData: FormData): Promise<ClubFormState> {
  const current = await session();
  if (!current.ok) return { status: "error", message: current.message };
  const code = z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .safeParse(formData.get("code"));
  if (!code.success) return { status: "error", message: "This invite link is invalid or has expired." };
  const { data: clubId, error } = await current.supabase.rpc("join_club_with_invite", { p_code: code.data });
  if (error) {
    const message =
      error.code === "P0002"
        ? "This invite link is invalid or has expired."
        : error.code === "PT429"
          ? "Too many attempts. Please wait a while."
          : failMsg(error, "Could not join the club.");
    return { status: "error", message };
  }
  const slug = await slugOf(current.supabase, clubId as string);
  revalidatePath("/clubs");
  redirect(slug ? `/clubs/${slug}` : "/clubs");
}
