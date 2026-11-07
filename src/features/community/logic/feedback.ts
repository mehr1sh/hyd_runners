import { z } from "zod";
import { FeedbackStatus, FeedbackTarget, RunnerFeedback } from "@/lib/contracts";

export const FeedbackBarrier = z.enum(["consistency", "schedule_conflicts", "programme", "motivation", "other"]);
export type FeedbackBarrier = z.infer<typeof FeedbackBarrier>;

export const BARRIER_LABEL: Record<FeedbackBarrier, string> = {
  consistency: "Consistency",
  schedule_conflicts: "Schedule conflicts",
  programme: "Programme feedback",
  motivation: "Motivation",
  other: "Something else",
};

export const STATUS_LABEL: Record<z.infer<typeof FeedbackStatus>, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

export function barrierToTarget(barrier: FeedbackBarrier): z.infer<typeof FeedbackTarget> {
  return barrier === "programme" ? "programme" : "app";
}

export const FeedbackDraft = z.object({
  barrier: FeedbackBarrier,
  body: z.string().trim().min(1, "Tell us what is getting in the way.").max(2000),
  rating: z.number().int().min(1).max(5).nullable(),
});
export type FeedbackDraft = z.infer<typeof FeedbackDraft>;

export const ParticipationFeedback = RunnerFeedback.extend({
  barrier: FeedbackBarrier,
  assignedTo: z.uuid().nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ParticipationFeedback = z.infer<typeof ParticipationFeedback>;

export const FeedbackReplyDraft = z.object({
  feedbackId: z.uuid(),
  body: z.string().trim().min(1, "Write a reply.").max(2000),
});

export const FeedbackAssignDraft = z.object({
  feedbackId: z.uuid(),
  assignedTo: z.uuid(),
  status: FeedbackStatus.optional(),
});

export function parseFeedbackForm(formData: FormData) {
  const ratingRaw = formData.get("rating");
  const rating = ratingRaw === null || ratingRaw === "" ? null : Number(ratingRaw);
  const parsed = FeedbackDraft.safeParse({
    barrier: formData.get("barrier"),
    body: formData.get("body"),
    rating,
  });
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Some fields are missing or invalid." };
  }
  return { ok: true as const, data: parsed.data };
}

export function parseReplyForm(formData: FormData) {
  const parsed = FeedbackReplyDraft.safeParse({
    feedbackId: formData.get("feedbackId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Write a reply." };
  }
  return { ok: true as const, data: parsed.data };
}
