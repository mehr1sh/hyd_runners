import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { leaveLeague } from "@/features/leagues/actions";
import { AddTeamForm, JoinTeamForm, LeagueAdminForm } from "@/features/leagues/components/forms";
import { LEAGUE_KINDS, SCORING_LABEL, type ScoringKey } from "@/features/leagues/logic";
import { leagueDetail } from "@/features/leagues/queries";

export const metadata: Metadata = { title: "League" };

export default async function LeaguePage({ params }: PageProps<"/leagues/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getRunnerContext();
  if (!ctx) return <RunnerPreviewNotice feature="leagues" />;
  const detail = await leagueDetail(ctx.supabase, id, ctx.user.id);
  if (!detail) notFound();
  const { league, teams, standings, myTeamId } = detail;
  const isAdmin = detail.isAdmin || ctx.user.roles.includes("admin") || ctx.user.roles.includes("programme_manager");
  const clubs = isAdmin
    ? (((await ctx.supabase.from("clubs").select("id, name").order("name").limit(100)).data ?? []) as {
        id: string;
        name: string;
      }[])
    : [];
  const finished = league.endsOn < ctx.today;
  const weights = (Object.keys(SCORING_LABEL) as ScoringKey[]).filter((k) => (league.scoring[k] ?? 0) > 0);

  return (
    <>
      <PageHeader
        title={league.name}
        description={league.description ?? `${LEAGUE_KINDS[league.kind]}, ${league.startsOn} to ${league.endsOn}`}
      />
      <p className="mb-4 text-sm">
        <Link href="/leagues" className="underline underline-offset-4">
          All leagues
        </Link>
      </p>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="teams-h" className="space-y-2">
            <h2 id="teams-h" className="font-semibold text-brand-navy">
              Team standings{finished ? " (final)" : ""}
            </h2>
            {!standings || standings.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2">#</th>
                      <th className="p-2">Team</th>
                      <th className="p-2">Points</th>
                      <th className="p-2">Per runner</th>
                      <th className="p-2">Active days</th>
                      <th className="p-2">Km</th>
                      <th className="p-2">Runners</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.teams.map((t, i) => (
                      <tr key={t.teamId} className={`border-t ${t.teamId === myTeamId ? "bg-brand-navy-soft" : ""}`}>
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2 font-medium">{t.name}</td>
                        <td className="p-2">{t.points}</td>
                        <td className="p-2">{t.perMember ?? "—"}</td>
                        <td className="p-2">{t.activeDays}</td>
                        <td className="p-2">{t.km}</td>
                        <td className="p-2">{t.members}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="ind-h" className="space-y-2">
            <h2 id="ind-h" className="font-semibold text-brand-navy">
              Runners
            </h2>
            {!standings || standings.individuals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runners yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2">#</th>
                      <th className="p-2">Runner</th>
                      <th className="p-2">Team</th>
                      <th className="p-2">Points</th>
                      <th className="p-2">Days</th>
                      <th className="p-2">Consistent weeks</th>
                      <th className="p-2">Group runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.individuals.map((r, i) => (
                      <tr key={i} className={`border-t ${r.me ? "bg-brand-navy-soft" : ""}`}>
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2">
                          {r.name ?? <span className="text-muted-foreground">Hidden runner</span>}
                        </td>
                        <td className="p-2">{r.team}</td>
                        <td className="p-2">{r.points}</td>
                        <td className="p-2">{r.activeDays}</td>
                        <td className="p-2">{r.consistentWeeks}</td>
                        <td className="p-2">{r.groupRuns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Runners who hide themselves from leaderboards still count for their team but aren&apos;t named. Calculated{" "}
              {standings?.computedAt.slice(0, 16).replace("T", " ")} UTC.
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <section aria-labelledby="rules-h" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <h2 id="rules-h" className="font-semibold text-brand-navy">
              How points work
            </h2>
            <ul className="space-y-1">
              {weights.map((k) => (
                <li key={k}>
                  <span className="font-medium">{league.scoring[k]}</span> {SCORING_LABEL[k]}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              From your imported or recorded activities between {league.startsOn} and {league.endsOn}. Several runs on
              one day count as one active day, and duplicate imports are rejected. Speed never earns points.
            </p>
          </section>

          <section aria-labelledby="join-h" className="space-y-2 rounded-xl border bg-card p-4">
            <h2 id="join-h" className="font-semibold text-brand-navy">
              {myTeamId ? "Your team" : "Join a team"}
            </h2>
            {myTeamId ? (
              <>
                <p className="text-sm">{teams.find((t) => t.id === myTeamId)?.name}</p>
                <form action={leaveLeague}>
                  <input type="hidden" name="leagueId" value={league.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Leave league
                  </Button>
                </form>
              </>
            ) : league.status !== "active" || finished ? (
              <p className="text-sm text-muted-foreground">This league isn&apos;t open for new runners.</p>
            ) : (
              <ul className="space-y-2">
                {teams.map((t) => (
                  <li key={t.id}>
                    <JoinTeamForm
                      leagueId={league.id}
                      teamId={t.id}
                      needsCode={t.affiliation !== "club"}
                      label={t.name}
                    />
                    {t.affiliation === "club" && (
                      <p className="text-xs text-muted-foreground">For members of the club.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isAdmin && (
            <section aria-labelledby="admin-h" className="space-y-3 rounded-xl border bg-card p-4">
              <h2 id="admin-h" className="font-semibold text-brand-navy">
                Organise
              </h2>
              <ul className="space-y-1 text-sm">
                {teams.map((t) => (
                  <li key={t.id}>
                    {t.name}{" "}
                    {t.joinCode ? (
                      <Badge variant="outline">Code {t.joinCode}</Badge>
                    ) : (
                      <span className="text-muted-foreground">club members</span>
                    )}
                  </li>
                ))}
              </ul>
              <AddTeamForm leagueId={league.id} clubs={clubs} />
              <LeagueAdminForm leagueId={league.id} scoring={league.scoring} status={league.status} />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
