import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { providers, type ProviderStatus } from "@/features/integrations/providers";

export const metadata: Metadata = { title: "Connected apps and devices" };

const STATUS: Record<ProviderStatus, string> = {
  available: "Available",
  needs_configuration: "Not set up yet",
  requires_app_build: "Coming with the HYD Runners app",
  not_available: "Not available",
};

export default function IntegrationsPage() {
  const list = providers({
    stravaConfigured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
  });
  return (
    <>
      <PageHeader
        title="Connected apps and devices"
        description="Where your activities can come from, what each source reads, and how to revoke it. Only sources marked Available work today."
      />
      <ul className="max-w-3xl space-y-3" aria-label="Activity sources">
        {list.map((p) => (
          <li key={p.key} className="space-y-1 rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-brand-navy">{p.name}</h2>
              <Badge variant={p.status === "available" ? "default" : "outline"}>{STATUS[p.status]}</Badge>
            </div>
            <p>{p.summary}</p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Reads: </span>
              {p.dataUsed}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Revoking: </span>
              {p.revocation}
            </p>
            {p.requirement && <p className="text-muted-foreground">{p.requirement}</p>}
            {p.href && (
              <Link href={p.href} className="underline underline-offset-4">
                Import a file
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-3xl text-xs text-muted-foreground">
        Health data is never shared with coaches, other runners or AI providers unless you explicitly choose to share
        it.
      </p>
    </>
  );
}
