import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";
import { roulettePick } from "@/features/experiments/logic";

export const metadata: Metadata = { title: "Run Roulette" };

type R = {
  slug: string;
  name: string;
  area: string | null;
  distance_m: number;
  difficulty: string | null;
  beginner_suitable: boolean | null;
};

/** A fresh random pick per request, outside render. */
function pick(routes: R[]) {
  return roulettePick(routes, crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
}

export default async function RoulettePage({ searchParams }: PageProps<"/routes/roulette">) {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Run Roulette"
      description="A surprise route picked from verified, published routes only, never made-up roads."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="Run Roulette" />
      </>
    );
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const min = Math.max(0, Math.min(100, Number(one("min")) || 0));
  const max = Math.max(min, Math.min(100, Number(one("max")) || 0)) || null;
  const difficulty = ["easy", "moderate", "hard"].includes(one("difficulty")) ? one("difficulty") : "";
  const area = one("area").trim().slice(0, 60);
  const spun = one("spin") !== "";
  let q = ctx.supabase
    .from("routes")
    .select("slug, name, area, distance_m, difficulty, beginner_suitable")
    .eq("status", "published")
    .eq("verified", true)
    .limit(200);
  if (min) q = q.gte("distance_m", min * 1000);
  if (max) q = q.lte("distance_m", max * 1000);
  if (difficulty) q = q.eq("difficulty", difficulty);
  if (area) q = q.ilike("area", `%${area.replace(/[%_\\]/g, "")}%`);
  const { data } = spun ? await q : { data: [] };
  const routes = (data ?? []) as R[];
  const chosen = spun ? pick(routes) : null;
  return (
    <>
      {header}
      <div className="grid max-w-3xl gap-6">
        <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4 sm:items-end">
          <input type="hidden" name="spin" value="1" />
          <div className="space-y-1">
            <Label htmlFor="rr-min">From (km)</Label>
            <Input id="rr-min" name="min" type="number" min={0} max={100} defaultValue={min || ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-max">To (km)</Label>
            <Input id="rr-max" name="max" type="number" min={0} max={100} defaultValue={max ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-diff">Difficulty</Label>
            <select
              id="rr-diff"
              name="difficulty"
              defaultValue={difficulty}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-area">Area (optional)</Label>
            <Input id="rr-area" name="area" defaultValue={area} maxLength={60} />
          </div>
          <Button type="submit" className="sm:col-span-4 sm:justify-self-start">
            {spun ? "Spin again" : "Spin"}
          </Button>
        </form>
        {spun &&
          (chosen ? (
            <section aria-labelledby="pick-h" className="space-y-1 rounded-xl border-2 border-success bg-card p-4">
              <h2 id="pick-h" className="text-xl font-semibold text-brand-navy">
                {chosen.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {(chosen.distance_m / 1000).toFixed(1)} km{chosen.area ? ` · ${chosen.area}` : ""}
                {chosen.difficulty ? ` · ${chosen.difficulty}` : ""}
                {chosen.beginner_suitable ? " · beginner friendly" : ""} · picked from {routes.length} verified route
                {routes.length === 1 ? "" : "s"}
              </p>
              <Link href={`/routes/${chosen.slug}`} className="text-sm underline underline-offset-4">
                See the route, conditions and reports
              </Link>
            </section>
          ) : (
            <p className="rounded-xl border bg-card p-4 text-sm">
              No verified route matches. Widen the distance or clear the area.
            </p>
          ))}
      </div>
    </>
  );
}
