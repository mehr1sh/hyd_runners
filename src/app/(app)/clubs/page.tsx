import type { Metadata } from "next";
import Link from "next/link";
import { Flag, MapPin, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClubForm } from "@/features/clubs/components/club-forms";
import { JOIN_POLICY_SHORT } from "@/features/clubs/logic";
import { listClubs, myMemberships, statsFor } from "@/features/clubs/queries";
import { listLocations } from "@/features/community/queries";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Clubs" };

export default async function ClubsPage({ searchParams }: PageProps<"/clubs">) {
  const ctx = await getRunnerContext();
  const header = (
    <>
      <PageHeader title="Clubs" description="Find a running club near you and run with people who show up." />
      <p className="-mt-2 mb-4 flex flex-wrap gap-3 text-sm">
        <Link href="/clubs/pass" className="underline underline-offset-4">
          Your club pass
        </Link>
        <Link href="/captains" className="underline underline-offset-4">
          Run captains
        </Link>
      </p>
    </>
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="clubs" />
      </>
    );
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const after = typeof sp.after === "string" ? sp.after : null;
  const { clubs, nextAfter } = await listClubs(ctx.supabase, { q, after });
  const ids = clubs.map((c) => c.id);
  const isManager = ctx.user.roles.includes("programme_manager") || ctx.user.roles.includes("admin");
  const [stats, mine, locations] = await Promise.all([
    statsFor(ctx.supabase, ids),
    myMemberships(ctx.supabase, ctx.user.id, ids),
    isManager ? listLocations() : Promise.resolve([]),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <>
      {header}
      <div className="space-y-6">
        <form method="get" action="/clubs" className="flex flex-wrap items-end gap-2" role="search">
          <label className="grid flex-1 gap-1 text-sm">
            Search clubs
            <Input name="q" defaultValue={q} maxLength={60} placeholder="Club name" />
          </label>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {clubs.length === 0 ? (
          <EmptyState
            icon={Flag}
            title={q ? "No clubs match" : "No clubs yet"}
            description={q ? "Try another name." : "Clubs created by the programme team will appear here."}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {clubs.map((club) => {
              const s = stats.get(club.id);
              const m = mine.get(club.id);
              return (
                <li key={club.id} className="space-y-2 rounded-xl border bg-card p-4">
                  <h2 className="font-semibold text-brand-navy">
                    <Link href={`/clubs/${club.slug}`} className="underline-offset-4 hover:underline">
                      {club.name}
                    </Link>
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{JOIN_POLICY_SHORT[club.joinPolicy]}</Badge>
                    {m?.status === "active" && <Badge>Member</Badge>}
                    {m?.status === "pending" && <Badge variant="outline">Request sent</Badge>}
                  </div>
                  {club.description && <p className="line-clamp-2 text-sm text-muted-foreground">{club.description}</p>}
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {club.area && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden /> {club.area}
                        {club.homeLocationId && locationName.get(club.homeLocationId)
                          ? ` · ${locationName.get(club.homeLocationId)}`
                          : ""}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden /> {s?.members ?? 0} members · {s?.upcomingEvents ?? 0}{" "}
                      upcoming runs
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {nextAfter && (
          <Button asChild variant="outline">
            <Link href={`/clubs?${new URLSearchParams({ ...(q ? { q } : {}), after: nextAfter })}`}>More clubs</Link>
          </Button>
        )}
        {isManager && (
          <section className="space-y-2" aria-labelledby="create-club">
            <h2 id="create-club" className="font-semibold text-brand-navy">
              Create a club
            </h2>
            <p className="text-sm text-muted-foreground">
              You become its first club admin and can promote members to admin or captain from the club&apos;s page.
            </p>
            <ClubForm locations={locations} />
          </section>
        )}
      </div>
    </>
  );
}
