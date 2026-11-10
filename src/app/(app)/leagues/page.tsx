import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { CreateLeagueForm } from "@/features/leagues/components/forms";
import { LEAGUE_KINDS } from "@/features/leagues/logic";
import { listLeagues } from "@/features/leagues/queries";

export const metadata: Metadata = { title: "Leagues" };

const STATUS = { draft: "Draft", active: "Open", completed: "Finished", cancelled: "Cancelled" } as const;

export default async function LeaguesPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Leagues"
      description="Team competitions for clubs, universities, companies and the whole city. Points reward turning up and consistency, never speed."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="leagues" />
      </>
    );
  const leagues = await listLeagues(ctx.supabase, ctx.user.id);
  const canCreate = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          {leagues.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No leagues yet"
              description="Organisers create leagues for clubs, campuses, companies and the city."
            />
          ) : (
            <ul className="space-y-2" aria-label="Leagues">
              {leagues.map((l) => (
                <li key={l.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leagues/${l.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {l.name}
                    </Link>
                    <Badge variant="outline">{LEAGUE_KINDS[l.kind]}</Badge>
                    <Badge variant={l.status === "active" ? "default" : "outline"}>{STATUS[l.status]}</Badge>
                    {l.myTeamId && <Badge variant="secondary">You&apos;re in</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {l.startsOn} to {l.endsOn}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canCreate && (
          <section aria-labelledby="new-league" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 id="new-league" className="font-semibold text-brand-navy">
              New league
            </h2>
            <CreateLeagueForm today={ctx.today} />
          </section>
        )}
      </div>
    </>
  );
}
