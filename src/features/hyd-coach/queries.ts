import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { CoachAnswer } from "./logic/types";

export type ConversationSummary = { id: string; title: string; lastMessageAt: string };
export type CoachMessage = {
  id: string;
  role: "runner" | "coach";
  body: string;
  source: "deterministic" | "ai_assisted" | "safety" | null;
  payload: (Omit<CoachAnswer, "text"> & { aiNote: string | null }) | null;
  createdAt: string;
};

export const RETENTION_DAYS = 180;

/** Applies the retention policy to the caller's conversations, then lists them. */
export async function listConversations(supabase: SupabaseClient): Promise<ConversationSummary[]> {
  await supabase.rpc("purge_my_stale_coach_conversations");
  const { data, error } = await supabase
    .from("coach_conversations")
    .select("id, title, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(50);
  if (error) throw new DatabaseQueryError("coach_conversations", error);
  return (data ?? []).map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.last_message_at }));
}

export async function getConversation(supabase: SupabaseClient, id: string) {
  const [conv, msgs] = await Promise.all([
    supabase.from("coach_conversations").select("id, title").eq("id", id).maybeSingle(),
    supabase
      .from("coach_messages")
      .select("id, role, body, source, payload, created_at")
      .eq("conversation_id", id)
      .order("created_at")
      .limit(200),
  ]);
  if (conv.error) throw new DatabaseQueryError("coach_conversations", conv.error);
  if (msgs.error) throw new DatabaseQueryError("coach_messages", msgs.error);
  if (!conv.data) return null;
  return {
    id: conv.data.id as string,
    title: conv.data.title as string,
    messages: (msgs.data ?? []).map((m): CoachMessage => ({
      id: m.id,
      role: m.role,
      body: m.body,
      source: m.source,
      payload: m.payload,
      createdAt: m.created_at,
    })),
  };
}
