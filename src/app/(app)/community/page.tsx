import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setLeaderboardVisibilityAction } from "@/features/community/actions";
import { AnnouncementList, type AnnouncementItem } from "@/features/community/components/announcement-list";
import { FeedbackPanel } from "@/features/community/components/feedback-panel";
import { MessagePanel } from "@/features/community/components/message-panel";
import { listAnnouncements, listFeedback, listMessages, listRecipients } from "@/features/community/service";
import { getRunnerContext } from "@/features/dashboard/context";
import { formatLocalDate } from "@/features/dashboard/format";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { RULES } from "@/features/gamification/logic/rewards";
import { addDays } from "@/features/gamification/logic/time";
import { loadLeaderboard } from "@/features/gamification/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Community"
      description="This week's leaderboard, announcements, feedback and in-app messages. Nothing here sends email or push."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the community leaderboard" />
      </>
    );

  const [board, announcements, feedback, messages, recipients] = await Promise.all([
    loadLeaderboard(ctx),
    listAnnouncements(ctx.supabase, ctx.user.id),
    listFeedback(ctx.supabase, ctx.user.id),
    listMessages(ctx.supabase, ctx.user.id),
    listRecipients(ctx.supabase),
  ]);
  const announcementItems: AnnouncementItem[] = announcements.ok
    ? announcements.data.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        publishAt: item.publishAt,
        audience: item.audience,
        unread: item.unread,
        scheduled: item.scheduled,
      }))
    : [];

  return (
    <>
      {header}
      <Tabs defaultValue="leaderboard">
        {/* Four tabs: scroll on narrow phones instead of clipping. */}
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="announcements">Announcements</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="leaderboard" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-4 text-brand-red" aria-hidden /> This week
              </CardTitle>
              <CardDescription>
                XP earned {formatLocalDate(board.weekStart, { day: "numeric", month: "short" })} –{" "}
                {formatLocalDate(addDays(board.weekStart, 6), { day: "numeric", month: "short" })}. Resets every Monday.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {board.rows.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="No XP earned yet this week"
                  description="Complete a workout to get on the board."
                />
              ) : (
                <Table>
                  <TableCaption className="sr-only">Weekly XP leaderboard</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Rank</TableHead>
                      <TableHead>Runner</TableHead>
                      <TableHead className="text-right">Workouts</TableHead>
                      <TableHead className="text-right">XP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {board.rows.map((r) => (
                      <TableRow
                        key={`${r.rank}-${r.displayName}-${r.isMe}`}
                        className={cn(r.isMe && "bg-brand-navy-soft")}
                      >
                        <TableCell className="font-semibold tabular-nums">{r.rank}</TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="font-medium text-brand-navy">{r.displayName}</span>
                          {r.isMe && <Badge className="ml-2">You</Badge>}
                          {/\(sample\)/i.test(r.displayName) && (
                            <Badge variant="outline" className="ml-2">
                              Sample runner
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.workouts}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{r.xp}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>How scoring works</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    First workout of the day (10+ min): {RULES.workoutBaseXp} XP + 1 per 5 minutes, up to +
                    {RULES.workoutDurationBonusCap}.
                  </li>
                  <li>Following your plan: +{RULES.planBonusXp} XP, once a day.</li>
                  <li>Streak milestones and badges add bonus XP.</li>
                  <li>After 6 rewarded days in a week, the 7th earns no XP: rest is part of training.</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Your privacy</CardTitle>
                <CardDescription>
                  The leaderboard shows display names and weekly XP only. Never locations or emails.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={setLeaderboardVisibilityAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="show" value={board.showMe ? "false" : "true"} />
                  <p className="text-sm text-brand-navy">
                    {board.showMe
                      ? "Other runners can see you on the leaderboard."
                      : "You are hidden from other runners."}
                  </p>
                  <Button type="submit" variant="outline" size="sm">
                    {board.showMe ? "Hide me" : "Show me"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="announcements" className="pt-4">
          {announcements.ok ? (
            <AnnouncementList items={announcementItems} />
          ) : (
            <p className="text-sm text-destructive">{announcements.message}</p>
          )}
        </TabsContent>
        <TabsContent value="feedback" className="pt-4">
          {feedback.ok ? (
            <FeedbackPanel items={feedback.data} mode="runner" />
          ) : (
            <p className="text-sm text-destructive">{feedback.message}</p>
          )}
        </TabsContent>
        <TabsContent value="messages" className="pt-4">
          {messages.ok && recipients.ok ? (
            <MessagePanel messages={messages.data} recipients={recipients.data} viewerId={ctx.user.id} />
          ) : (
            <p className="text-sm text-destructive">
              {!messages.ok ? messages.message : !recipients.ok ? recipients.message : "Could not load messages."}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
