import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { SocialButton, SocialSettingsForm } from "@/features/social/components/social-forms";
import { myConnections, searchRunners, type Connection } from "@/features/social/queries";

export const metadata: Metadata = { title: "Runners" };

function People({
  title,
  people,
  actions,
}: {
  title: string;
  people: Connection[];
  actions: (c: Connection) => React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label={title}>
      <h2 className="font-semibold text-brand-navy">
        {title} ({people.length})
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {people.map((c) => (
            <li key={`${c.direction}-${c.userId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/runners/${c.userId}`} className="font-medium text-brand-navy">
                {c.displayName ?? "A runner"}
              </Link>
              <span className="flex flex-wrap gap-2">{actions(c)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function RunnersPage({ searchParams }: PageProps<"/runners">) {
  const ctx = await getRunnerContext();
  const header = <PageHeader title="Runners" description="Find runners, manage who follows you, and your privacy." />;
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="runners" />
      </>
    );
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const [results, mine] = await Promise.all([
    q.length >= 2 ? searchRunners(ctx.supabase, q) : Promise.resolve(null),
    myConnections(ctx.supabase, ctx.user.id),
  ]);
  const requests = mine.connections.filter((c) => c.direction === "follower" && c.status === "pending");
  const followers = mine.connections.filter((c) => c.direction === "follower" && c.status === "accepted");
  const following = mine.connections.filter((c) => c.direction === "following");

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="space-y-3" aria-label="Find runners">
            <form method="get" action="/runners" role="search" className="flex items-end gap-2">
              <div className="grid flex-1 gap-1">
                <Label htmlFor="runner-q">Find runners by name</Label>
                <Input id="runner-q" name="q" defaultValue={q} minLength={2} maxLength={60} />
              </div>
              <Button type="submit">Search</Button>
            </form>
            {results && (
              <ul aria-label="Search results" className="divide-y rounded-xl border bg-card px-4 text-sm">
                {results.length === 0 ? (
                  <li className="py-3 text-muted-foreground">
                    No runners found. Some runners choose not to be listed.
                  </li>
                ) : (
                  results.map((r) => (
                    <li key={r.id} className="py-3">
                      <Link href={`/runners/${r.id}`} className="font-medium text-brand-navy">
                        {r.displayName}
                      </Link>
                      {r.bio && <p className="text-muted-foreground">{r.bio}</p>}
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>
          <People
            title="Follow requests"
            people={requests}
            actions={(c) => (
              <>
                <SocialButton intent="accept" fields={{ userId: c.userId }} label="Accept" variant="default" />
                <SocialButton intent="remove_follower" fields={{ userId: c.userId }} label="Decline" />
              </>
            )}
          />
          <People
            title="Followers"
            people={followers}
            actions={(c) => <SocialButton intent="remove_follower" fields={{ userId: c.userId }} label="Remove" />}
          />
          <People
            title="Following"
            people={following}
            actions={(c) => (
              <>
                {c.status === "pending" && <span className="text-muted-foreground">Requested</span>}
                <SocialButton
                  intent="unfollow"
                  fields={{ userId: c.userId }}
                  label={c.status === "pending" ? "Cancel" : "Unfollow"}
                />
              </>
            )}
          />
        </div>
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-4" aria-labelledby="social-settings">
            <h2 id="social-settings" className="font-semibold text-brand-navy">
              Your social settings
            </h2>
            <SocialSettingsForm {...mine.settings} />
            <p className="text-xs text-muted-foreground">
              Each activity has its own visibility: only me (the default), followers, or everyone signed in. Others only
              ever see your privacy-trimmed route, never heart rate or your full GPS track.
            </p>
          </section>
          <section className="space-y-2 rounded-xl border bg-card p-4 text-sm" aria-label="Blocked runners">
            <h2 className="font-semibold text-brand-navy">Blocked runners ({mine.blocked.length})</h2>
            <p className="text-muted-foreground">
              Blocked runners can&apos;t see your activities, comments or kudos, follow you or find you. You can unblock
              them from their profile.
            </p>
            {mine.blocked.length > 0 && (
              <ul className="space-y-1">
                {mine.blocked.map((id) => (
                  <li key={id}>
                    <Link href={`/runners/${id}`} className="underline underline-offset-4">
                      Blocked runner
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
