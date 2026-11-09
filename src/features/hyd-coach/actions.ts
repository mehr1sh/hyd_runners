"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { composeAnswer, conversationTitle } from "./server/ask";

export type CoachState = { status: "idle" | "error"; message?: string };

const Ask = z.object({
  question: z.string().trim().min(3, "Ask a question first.").max(500, "Questions can be up to 500 characters."),
  conversationId: z.uuid().optional(),
});

export async function askCoach(_prev: CoachState, formData: FormData): Promise<CoachState> {
  if (!isSupabaseConfigured) return { status: "error", message: "Unavailable in preview mode." };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to continue." };
  const parsed = Ask.safeParse({
    question: formData.get("question"),
    conversationId: formData.get("conversationId") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your question." };
  const { question } = parsed.data;
  const supabase = await createClient();

  let conversationId = parsed.data.conversationId;
  if (!conversationId) {
    const { data, error } = await supabase
      .from("coach_conversations")
      .insert({ user_id: user.id, title: conversationTitle(question) })
      .select("id")
      .single();
    if (error) return { status: "error", message: limitMessage(error.code) };
    conversationId = data.id as string;
  }

  const asked = await supabase
    .from("coach_messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "runner", body: question });
  if (asked.error) return { status: "error", message: limitMessage(asked.error.code) };

  let answer;
  try {
    answer = await composeAnswer(supabase, user.id, question);
  } catch (error) {
    console.error("[hyd-coach] could not build an answer", (error as { name?: string }).name);
    return { status: "error", message: "I couldn't load your data just now. Please try again." };
  }
  const { source, aiNote, text, ...payload } = answer;
  const saved = await supabase.from("coach_messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "coach",
    body: text,
    source,
    payload: { ...payload, aiNote },
  });
  if (saved.error) return { status: "error", message: "Your answer couldn't be saved. Please try again." };
  revalidatePath("/hyd-coach");
  redirect(`/hyd-coach?c=${conversationId}#latest`);
}

function limitMessage(code: string | undefined) {
  if (code === "PT429") return "You've asked a lot of questions recently. Please wait a little and try again.";
  if (code === "42501") return "That conversation isn't available.";
  return "Something went wrong. Please try again.";
}

export async function deleteConversation(formData: FormData) {
  if (!isSupabaseConfigured) return;
  const user = await getCurrentUser();
  if (!user) return;
  const id = z.uuid().safeParse(formData.get("conversationId"));
  if (!id.success) return;
  const supabase = await createClient();
  const { error } = await supabase.from("coach_conversations").delete().eq("id", id.data).eq("user_id", user.id);
  if (error) console.error("[hyd-coach] delete failed", error.code);
  revalidatePath("/hyd-coach");
  redirect("/hyd-coach");
}
