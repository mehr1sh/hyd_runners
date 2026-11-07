"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markAnnouncementReadAction } from "../actions";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  audience: string;
  unread: boolean;
  scheduled: boolean;
};

export function AnnouncementList({ items }: { items: AnnouncementItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No announcements yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-brand-navy">{item.title}</h2>
            {item.unread && <Badge>Unread</Badge>}
            {item.scheduled && <Badge variant="outline">Scheduled</Badge>}
            {item.audience !== "everyone" && <Badge variant="secondary">{item.audience.replaceAll("_", " ")}</Badge>}
          </div>
          <p className="text-sm">{item.body}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={item.publishAt}>{when.format(new Date(item.publishAt))}</time>
          </p>
          {item.unread && (
            <form action={markAnnouncementReadAction}>
              <input type="hidden" name="announcementId" value={item.id} />
              <Button type="submit" variant="outline" size="sm">
                Mark as read
              </Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
