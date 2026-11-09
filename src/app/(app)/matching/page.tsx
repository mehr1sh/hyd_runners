import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { formatPace } from "@/features/events/logic";
import { dismissMatch } from "@/features/squads/actions";
import { InviteToSquad, MatchingForm } from "@/features/squads/components/forms";
import { AREAS, type Area } from "@/features/squads/logic";
import { findMatches, myMatchingProfile, mySquads } from "@/features/squads/queries";

export const metadata: Metadata = { title: "Find running partners" };

export default async function MatchingPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Find running partners"
      description="Opt in to be matched with runners of a similar pace, distance, schedule and area. Matches are suggestions, not guarantees."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="runner matching" />
      </>
    );
  const [profile, { squads }] = await Promise.all([
    myMatchingProfile(ctx.supabase, ctx.user.id),
    mySquads(ctx.supabase, ctx.user.id),
  ]);
  const matches = profile?.optedIn ? await findMatches(ctx.supabase) : [];
  const captainOf = squads
    .filter((s) => s.myRole === "captain" && s.myStatus === "active")
    .map((s) => ({ id: s.id, name: s.name }));
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <section aria-labelledby="matches-h" className="min-w-0 space-y-3">
          <h2 id="matches-h" className="font-semibold text-brand-navy">
            Your matches
          </h2>
          {!profile?.optedIn ? (
            <p className="rounded-xl border bg-card p-4 text-sm">
              Turn on matching to see runners who fit your running. You&apos;re hidden until you do.
            </p>
          ) : matches.length === 0 ? (
            <p className="rounded-xl border bg-card p-4 text-sm">
              No good matches yet. Try adding more days or areas, or check back as more runners opt in.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Matches">
              {matches.map((m) => (
                <li key={m.userId} className="space-y-2 rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/runners/${m.userId}`} className="font-semibold underline-offset-4 hover:underline">
                      {m.displayName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {m.paceMin && m.paceMax
                        ? `${formatPace(m.paceMin)}–${formatPace(m.paceMax)} /km`
                        : "Pace not given"}
                    </span>
                  </div>
                  {m.intro && <p className="text-sm">{m.intro}</p>}
                  <div className="flex flex-wrap gap-1">
                    {m.reasons.map((r) => (
                      <Badge key={r} variant="outline">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  {m.sharedAreas.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Both run around {m.sharedAreas.map((a) => AREAS[a as Area] ?? a).join(", ")}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/runners/${m.userId}`}>View profile and follow</Link>
                    </Button>
                    <InviteToSquad userId={m.userId} squads={captainOf} />
                    <form action={dismissMatch}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Not for me
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Meet new running partners in public places, and tell someone where you&apos;re going. Blocked runners never
            appear, and you can block or report anyone from their profile.
          </p>
        </section>
        <section aria-labelledby="prefs-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="prefs-h" className="font-semibold text-brand-navy">
            Your matching preferences
          </h2>
          <MatchingForm profile={profile} />
        </section>
      </div>
    </>
  );
}
