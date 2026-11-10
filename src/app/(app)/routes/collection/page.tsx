import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Route collection" };

export default async function CollectionPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Route collection"
      description="Routes you've completed, matched from your own GPS tracks (start, finish and shape within about 150 m). Collected only by running them."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="the route collection" />
      </>
    );
  const [done, all] = await Promise.all([
    ctx.supabase.rpc("my_route_completions"),
    ctx.supabase.from("routes").select("id, slug, name, area").eq("status", "published").order("area").limit(500),
  ]);
  const completed = new Map(
    ((done.data ?? []) as { route_id: string; times: number; first_completed_at: string }[]).map((c) => [
      c.route_id,
      c,
    ]),
  );
  const routes = (all.data ?? []) as { id: string; slug: string; name: string; area: string | null }[];
  const areas = [...new Set(routes.map((r) => r.area ?? "Other"))];
  return (
    <>
      {header}
      <p className="mb-4 text-sm">
        <span className="text-2xl font-semibold">{completed.size}</span> of {routes.length} routes collected
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {areas.map((a) => {
          const list = routes.filter((r) => (r.area ?? "Other") === a);
          const got = list.filter((r) => completed.has(r.id)).length;
          return (
            <section key={a} aria-label={`${a} collection`} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
              <h2 className="flex items-center justify-between font-semibold text-brand-navy">
                {a}
                <Badge variant={got === list.length ? "default" : "outline"}>
                  {got}/{list.length}
                </Badge>
              </h2>
              <ul className="space-y-1">
                {list.map((r) => {
                  const c = completed.get(r.id);
                  return (
                    <li key={r.id} className="flex justify-between gap-2">
                      <Link href={`/routes/${r.slug}`} className="underline-offset-4 hover:underline">
                        {c ? "✓ " : ""}
                        {r.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {c ? `${c.times}× · first ${c.first_completed_at.slice(0, 10)}` : "Not yet"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
