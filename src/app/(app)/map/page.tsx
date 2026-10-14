import type { Metadata } from "next";
import { LocationMap } from "@/components/map/location-map";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Badge } from "@/components/ui/badge";
import { listLocations } from "@/features/community/queries";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage() {
  const locations = await listLocations();
  const points = locations.map((l) => ({
    id: l.id,
    name: l.name,
    latitude: l.latitude,
    longitude: l.longitude,
    note: l.verified ? undefined : "Unverified location",
  }));

  return (
    <>
      <PageHeader title="Places to run" description="Parks, tracks and lake loops used by the community." />
      <div className="space-y-6">
        <PlaceholderNotice feature="the location map" owner="Community">
          Pins come from the locations table. Unverified pins are approximate sample locations.
        </PlaceholderNotice>
        <LocationMap points={points} label="Map of running locations in Hyderabad" />
        <ul className="divide-y rounded-xl border bg-card">
          {locations.length === 0 && <li className="p-4 text-sm text-muted-foreground">No locations added yet.</li>}
          {locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-brand-navy">{l.name}</p>
                {l.address && <p className="text-muted-foreground">{l.address}</p>}
              </div>
              {!l.verified && <Badge variant="outline">Unverified</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
