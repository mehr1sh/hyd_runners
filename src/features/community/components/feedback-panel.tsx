"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { replyToFeedbackAction, submitFeedbackAction, updateFeedbackAction, type FormState } from "../actions";
import { BARRIER_LABEL, STATUS_LABEL } from "../logic/feedback";
import { ReportForm } from "./report-form";

const idle: FormState = { status: "idle" };
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export type FeedbackItem = {
  id: string;
  userId: string;
  body: string;
  barrier: keyof typeof BARRIER_LABEL;
  status: keyof typeof STATUS_LABEL;
  rating: number | null;
  createdAt: string;
  authorName: string;
  assigneeName: string | null;
  assignedTo: string | null;
  reported: boolean;
  replies: {
    id: string;
    authorId: string;
    authorName: string;
    body: string | null;
    hidden: boolean;
    reported: boolean;
    createdAt: string;
  }[];
};

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export function FeedbackPanel({
  items,
  mode,
  viewerId,
  staff = [],
}: {
  items: FeedbackItem[];
  mode: "runner" | "coach" | "manager";
  viewerId: string;
  staff?: { id: string; displayName: string }[];
}) {
  return (
    <div className="space-y-6">
      {mode === "runner" && <FeedbackForm />}
      {items.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          {mode === "runner" ? "You have not submitted feedback yet." : "No feedback is waiting."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{BARRIER_LABEL[item.barrier]}</Badge>
                <Badge variant="outline">{STATUS_LABEL[item.status]}</Badge>
                {item.rating && <span className="text-xs text-muted-foreground">Rating {item.rating}/5</span>}
              </div>
              <p className="text-sm text-brand-navy">{item.body}</p>
              <p className="text-xs text-muted-foreground">
                {item.authorName} · <time dateTime={item.createdAt}>{when.format(new Date(item.createdAt))}</time>
                {item.assigneeName ? ` · Assigned to ${item.assigneeName}` : ""}
              </p>
              {item.replies.length > 0 && (
                <ul className="space-y-2 border-l-2 border-brand-navy-soft pl-3">
                  {item.replies.map((reply) => (
                    <li key={reply.id} className="text-sm">
                      <p className="font-medium text-brand-navy">{reply.authorName}</p>
                      {reply.hidden ? (
                        <p className="text-muted-foreground italic">This reply was removed by a moderator.</p>
                      ) : (
                        <p className="whitespace-pre-wrap">{reply.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        <time dateTime={reply.createdAt}>{when.format(new Date(reply.createdAt))}</time>
                      </p>
                      {reply.authorId !== viewerId && !reply.hidden && (
                        <ReportForm targetType="feedback_reply" targetId={reply.id} alreadyReported={reply.reported} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {mode === "coach" && item.userId !== viewerId && (
                <ReportForm targetType="feedback" targetId={item.id} alreadyReported={item.reported} />
              )}
              <ReplyForm feedbackId={item.id} />
              {mode === "manager" && <AssignForm item={item} staff={staff} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackForm() {
  const [state, action, pending] = useActionState(submitFeedbackAction, idle);
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      <Field>
        <FieldLabel htmlFor="barrier">What is getting in the way?</FieldLabel>
        <select id="barrier" name="barrier" required defaultValue="consistency" className={selectClass}>
          {Object.entries(BARRIER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="feedback-body">Tell us more</FieldLabel>
        <Textarea id="feedback-body" name="body" required maxLength={2000} placeholder="What should we adapt?" />
      </Field>
      <Field>
        <FieldLabel htmlFor="rating">Rating (optional)</FieldLabel>
        <InputNumber />
      </Field>
      {state.message && (
        <Alert
          variant={state.status === "error" ? "destructive" : "default"}
          role={state.status === "error" ? "alert" : "status"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit feedback"}
      </Button>
    </form>
  );
}

function InputNumber() {
  return <input id="rating" name="rating" type="number" min={1} max={5} className={selectClass} />;
}

function ReplyForm({ feedbackId }: { feedbackId: string }) {
  const [state, action, pending] = useActionState(replyToFeedbackAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <FieldLabel htmlFor={`reply-${feedbackId}`}>Reply</FieldLabel>
      <Textarea id={`reply-${feedbackId}`} name="body" required maxLength={2000} />
      {state.status === "error" && state.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}

function AssignForm({ item, staff }: { item: FeedbackItem; staff: { id: string; displayName: string }[] }) {
  const [state, action, pending] = useActionState(updateFeedbackAction, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="feedbackId" value={item.id} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Assign
        <select name="assignedTo" defaultValue={item.assignedTo ?? ""} className={selectClass}>
          <option value="">Unassigned</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Status
        <select name="status" defaultValue={item.status} className={selectClass}>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Update"}
      </Button>
      {state.status === "error" && state.message && (
        <p className="text-sm text-destructive sm:col-span-3">{state.message}</p>
      )}
    </form>
  );
}
