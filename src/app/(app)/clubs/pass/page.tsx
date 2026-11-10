import type { Metadata } from "next";
import Link from "next/link";
import { IdCard } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatDateTime } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Club pass" };

export default async function ClubPassPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Club pass"
      description="All your clubs in one place: membership, upcoming club runs and your attendance."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the club pass" />
      </>
    );
  const { data: memberships } = await ctx.supabase
    .from("club_members")
    .select("club_id, role, status, joined_at, clubs!inner(id, slug, name, area)")
    .eq("user_id", ctx.user.id);
  const rows = (memberships ?? []) as unknown as {
    club_id: string;
    role: string;
    status: string;
    joined_at: string | null;
    clubs: { id: string; slug: string; name: string; area: string | null };
  }[];
  const ids = rows.map((r) => r.club_id);
  const [events, attended] = ids.length
    ? await Promise.all([
        ctx.supabase
          .from("events")
          .select("id, title, starts_at, club_id")
          .in("club_id", ids)
          .eq("status", "published")
          .gte("starts_at", new Date(Date.parse(ctx.today)).toISOString())
          .order("starts_at")
          .limit(30),
        ctx.supabase
          .from("event_rsvps")
          .select("event_id, status, checked_in_at, events!inner(club_id)")
          .eq("user_id", ctx.user.id)
          .in("events.club_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const att = (attended.data ?? []) as unknown as {
    event_id: string;
    status: string;
    checked_in_at: string | null;
    events: { club_id: string };
  }[];
  return (
    <>
      {header}
      {rows.length === 0 ? (
        <EmptyState
          icon={IdCard}
          title="No clubs yet"
          description="Join a club to see it on your pass."
          action={
            <Button asChild variant="outline">
              <Link href="/clubs">Browse clubs</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((m) => {
            const upcoming = (
              (events.data ?? []) as { id: string; title: string; starts_at: string; club_id: string }[]
            ).filter((e) => e.club_id === m.club_id);
            const mine = att.filter((a) => a.events.club_id === m.club_id);
            return (
              <section
                key={m.club_id}
                aria-label={m.clubs.name}
                className="space-y-2 rounded-2xl border bg-card p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/clubs/${m.clubs.slug}`}
                    className="text-lg font-semibold text-brand-navy underline-offset-4 hover:underline"
                  >
                    {m.clubs.name}
                  </Link>
                  <Badge variant={m.status === "active" ? "default" : "outline"}>
                    {m.status === "active" ? m.role : "Request pending"}
                  </Badge>
                </div>
                {m.joined_at && <p className="text-muted-foreground">Member since {m.joined_at.slice(0, 10)}</p>}
                <p>
                  {mine.filter((a) => a.checked_in_at).length} club run
                  {mine.filter((a) => a.checked_in_at).length === 1 ? "" : "s"} attended ·{" "}
                  {mine.filter((a) => a.status === "going" && !a.checked_in_at).length} booked
                </p>
                {upcoming.length > 0 && (
                  <ul className="space-y-1">
                    {upcoming.slice(0, 4).map((e) => (
                      <li key={e.id}>
                        <Link href={`/events/${e.id}`} className="underline-offset-4 hover:underline">
                          {e.title}
                        </Link>{" "}
                        <span className="text-muted-foreground">{formatDateTime(e.starts_at, ctx.timezone)}</span>
                        {mine.some((a) => a.event_id === e.id && a.status === "going") && " · you're going"}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
