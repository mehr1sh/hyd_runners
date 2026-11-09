import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { addDays } from "@/features/gamification/logic/time";
import { setAttendance } from "@/features/squads/actions";
import { ChatForm, ReportMessage, SquadButton, SquadRunForm } from "@/features/squads/components/forms";
import { squadAchievements, targetStreak } from "@/features/squads/logic";
import { squadDetail } from "@/features/squads/queries";

export const metadata: Metadata = { title: "Squad" };

const ist = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/** The current instant, read outside render. */
function nowIso() {
  return new Date().toISOString();
}

export default async function SquadPage({ params }: PageProps<"/squads/[id]">) {
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="squads" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const squad = await squadDetail(ctx.supabase, id, ctx.user.id);
  if (!squad) notFound();
  const me = squad.me;
  const isMember = me?.status === "active";
  const isCaptain = isMember && me?.role === "captain";
  const d = squad.dashboard;
  const active = squad.members.filter((m) => m.status === "active");
  const weeks = d?.weeks ?? [];
  const thisWeek = weeks.at(-1);
  const lastWeek = weeks.at(-2);
  const streak = targetStreak(weeks, squad.weeklyKmTarget);
  const achievements = squadAchievements(weeks, squad.weeklyKmTarget, active.length);
  const now = nowIso();

  return (
    <>
      <PageHeader title={squad.name} description={squad.description ?? "A HYD Runners squad."} />
      <p className="mb-4 text-sm">
        <Link href="/squads" className="underline underline-offset-4">
          All squads
        </Link>
      </p>
      {!isMember ? (
        <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <p>
            {me?.status === "invited"
              ? "You're invited to this squad."
              : me?.status === "requested"
                ? "Your request to join is waiting for a captain."
                : "Only members can see the squad's activity."}
          </p>
          {me?.status === "invited" && <SquadButton squadId={id} action="accept" label="Join" variant="default" />}
          {!me && squad.joinPolicy === "request" && <SquadButton squadId={id} action="request" label="Ask to join" />}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="week-h" className="space-y-3 rounded-xl border bg-card p-4">
              <h2 id="week-h" className="font-semibold text-brand-navy">
                This week together
              </h2>
              <p className="text-2xl font-semibold">
                {thisWeek?.km ?? 0} km
                {squad.weeklyKmTarget && (
                  <span className="text-base font-normal text-muted-foreground">
                    {" "}
                    of {squad.weeklyKmTarget} km target
                  </span>
                )}
              </p>
              {squad.weeklyKmTarget && (
                <div className="h-2 rounded bg-muted" aria-hidden>
                  <div
                    className="h-2 rounded bg-success"
                    style={{ width: `${Math.min(100, ((thisWeek?.km ?? 0) / squad.weeklyKmTarget) * 100)}%` }}
                  />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {thisWeek?.activeMembers ?? 0} of {active.length} members have run this week
                {squad.weeklyKmTarget ? ` · ${streak} week${streak === 1 ? "" : "s"} in a row on target` : ""}
              </p>
              {lastWeek && (
                <p className="text-sm">
                  <span className="font-medium">Last week&apos;s recap: </span>
                  {lastWeek.km} km from {lastWeek.activeMembers} runner{lastWeek.activeMembers === 1 ? "" : "s"}
                  {squad.weeklyKmTarget
                    ? lastWeek.km >= squad.weeklyKmTarget
                      ? ", target reached."
                      : ", target missed."
                    : "."}
                </p>
              )}
              <table className="w-full text-sm">
                <caption className="sr-only">Members this week, sorted by days active</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Member</th>
                    <th>Days active</th>
                    <th>Km</th>
                    <th>Squad runs</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(d?.members ?? [])]
                    .sort((a, b) => b.weekActiveDays - a.weekActiveDays || a.name.localeCompare(b.name))
                    .map((m) => (
                      <tr key={m.userId} className="border-t">
                        <td className="py-1">
                          {m.name}
                          {m.role === "captain" && <span className="text-xs text-muted-foreground"> · captain</span>}
                        </td>
                        <td>{m.weekActiveDays}</td>
                        <td>{m.weekKm}</td>
                        <td>{m.attended}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Ranked by days active, not speed. Distances come from imported or recorded activities.
              </p>
            </section>

            <section aria-labelledby="cal-h" className="space-y-3 rounded-xl border bg-card p-4">
              <h2 id="cal-h" className="font-semibold text-brand-navy">
                Squad calendar
              </h2>
              <ul className="space-y-2 text-sm">
                {squad.runs
                  .filter((r) => r.startsAt >= addDays(ctx.today, -7))
                  .map((r) => {
                    const mine = squad.attendance.find((a) => a.run_id === r.id && a.user_id === ctx.user.id)?.status;
                    const going = squad.attendance.filter((a) => a.run_id === r.id && a.status !== "not_going").length;
                    const started = r.startsAt <= now;
                    return (
                      <li key={r.id} className="space-y-1 border-t pt-2">
                        <p className="font-medium">
                          {r.title} · {ist(r.startsAt)}
                        </p>
                        <p className="text-muted-foreground">
                          Meet at {r.meetingPoint} · {going} going{r.notes ? ` · ${r.notes}` : ""}
                        </p>
                        <form action={setAttendance} className="flex flex-wrap gap-2">
                          <input type="hidden" name="runId" value={r.id} />
                          <input type="hidden" name="squadId" value={id} />
                          {(started ? (["attended", "not_going"] as const) : (["going", "not_going"] as const)).map(
                            (st) => (
                              <Button
                                key={st}
                                type="submit"
                                name="status"
                                value={st}
                                size="sm"
                                variant={mine === st ? "default" : "outline"}
                              >
                                {st === "going" ? "I'm going" : st === "attended" ? "I was there" : "Can't make it"}
                              </Button>
                            ),
                          )}
                        </form>
                      </li>
                    );
                  })}
              </ul>
              <SquadRunForm squadId={id} minDate={ctx.today} />
              <p className="text-xs text-muted-foreground">
                Choose public meeting points. Squad runs are visible only to members.
              </p>
            </section>

            <section aria-labelledby="chat-h" className="space-y-3 rounded-xl border bg-card p-4">
              <h2 id="chat-h" className="font-semibold text-brand-navy">
                Chat
              </h2>
              <ChatForm squadId={id} />
              <ul className="space-y-2 text-sm" aria-label="Squad messages">
                {squad.messages.map((m) => (
                  <li key={m.id}>
                    <span className="font-medium">{m.author}</span>{" "}
                    <span className="text-xs text-muted-foreground">{ist(m.createdAt)}</span>
                    <p className={m.hidden ? "text-muted-foreground italic" : ""}>
                      {m.hidden ? "Hidden by a moderator." : m.body}
                    </p>
                    {m.authorId !== ctx.user.id && !m.hidden && <ReportMessage messageId={m.id} />}
                  </li>
                ))}
                {squad.messages.length === 0 && <li className="text-muted-foreground">No messages yet.</li>}
              </ul>
            </section>
          </div>

          <aside className="space-y-4">
            <section aria-labelledby="ach-h" className="space-y-2 rounded-xl border bg-card p-4">
              <h2 id="ach-h" className="font-semibold text-brand-navy">
                Shared achievements
              </h2>
              {achievements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Earned together from your weekly totals: hit the target, keep a streak, reach 100 km.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {achievements.map((a) => (
                    <li key={a.key}>
                      <span className="font-medium">{a.title}</span> · {a.detail}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="chal-h" className="space-y-2 rounded-xl border bg-card p-4">
              <h2 id="chal-h" className="font-semibold text-brand-navy">
                Challenges you&apos;re in
              </h2>
              {(d?.challenges ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Join a{" "}
                  <Link href="/challenges" className="underline underline-offset-4">
                    challenge
                  </Link>{" "}
                  together to see everyone&apos;s progress here.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d!.challenges.map((c) => (
                    <li key={c.id}>
                      <Link href={`/challenges/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                        {c.title}
                      </Link>
                      <ul className="text-muted-foreground">
                        {(c.members ?? []).map((m) => (
                          <li key={m.name}>
                            {m.name}:{" "}
                            {m.completed
                              ? "completed"
                              : `${Math.min(100, Math.round((Number(m.progress) / Number(c.goal)) * 100))}%`}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="roster-h" className="space-y-2 rounded-xl border bg-card p-4">
              <h2 id="roster-h" className="font-semibold text-brand-navy">
                Members ({active.length} of {squad.maxMembers})
              </h2>
              <ul className="space-y-2 text-sm">
                {squad.members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center justify-between gap-1">
                    <span>
                      {m.name}
                      {m.role === "captain" && m.status === "active" && (
                        <Badge variant="outline" className="ml-1">
                          Captain
                        </Badge>
                      )}
                      {m.status !== "active" && <span className="text-muted-foreground"> · {m.status}</span>}
                    </span>
                    {isCaptain && m.userId !== ctx.user.id && (
                      <span className="flex gap-1">
                        {m.status === "requested" && (
                          <SquadButton squadId={id} userId={m.userId} action="approve" label="Approve" />
                        )}
                        {m.status === "active" && m.role !== "captain" && (
                          <SquadButton
                            squadId={id}
                            userId={m.userId}
                            action="make_captain"
                            label="Make captain"
                            variant="ghost"
                          />
                        )}
                        <SquadButton
                          squadId={id}
                          userId={m.userId}
                          action="remove"
                          label="Remove"
                          variant="ghost"
                          confirm={`Remove ${m.name}?`}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {isCaptain && (
                <p className="text-xs text-muted-foreground">
                  Invite runners from{" "}
                  <Link href="/matching" className="underline underline-offset-4">
                    matching
                  </Link>
                  .
                </p>
              )}
              <SquadButton
                squadId={id}
                action="leave"
                label="Leave squad"
                variant="ghost"
                confirm="Leave this squad?"
              />
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
