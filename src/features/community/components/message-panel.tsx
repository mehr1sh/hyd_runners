"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { sendMessageAction, type FormState } from "../actions";

const idle: FormState = { status: "idle" };
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-brand-navy outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export function MessagePanel({
  messages,
  recipients,
  viewerId,
}: {
  messages: {
    id: string;
    senderId: string;
    senderName: string;
    recipientName: string;
    body: string;
    createdAt: string;
  }[];
  recipients: { id: string; displayName: string; roles: string[] }[];
  viewerId: string;
}) {
  const [state, action, pending] = useActionState(sendMessageAction, idle);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Messages stay in the app. Email and push are not sent.</p>
      {recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is available to message yet.</p>
      ) : (
        <form action={action} className="space-y-3 rounded-xl border bg-card p-4">
          <Field>
            <FieldLabel htmlFor="recipientId">To</FieldLabel>
            <select id="recipientId" name="recipientId" required className={selectClass} defaultValue="">
              <option value="" disabled>
                Choose a person
              </option>
              {recipients.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName} ({person.roles.join(", ")})
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="message-body">Message</FieldLabel>
            <Textarea id="message-body" name="body" required maxLength={2000} />
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
            {pending ? "Sending…" : "Send message"}
          </Button>
        </form>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <ol className="space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-xl border bg-card p-4 text-sm">
              <p className="font-medium text-brand-navy">
                {message.senderId === viewerId ? "You" : message.senderName} to {message.recipientName}
              </p>
              <p className="mt-1">{message.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <time dateTime={message.createdAt}>{when.format(new Date(message.createdAt))}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
