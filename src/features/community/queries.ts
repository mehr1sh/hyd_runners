import "server-only";
import { CommunityEvent, Location } from "@/lib/contracts";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Upcoming published events, soonest first. RLS limits rows to what the caller may see. */
export async function listUpcomingEvents(limit = 20): Promise<CommunityEvent[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, description, starts_at, ends_at, location_id, capacity, status, created_by")
    .eq("status", "published")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load events: ${error.message}`);

  return (data ?? []).map((row) =>
    CommunityEvent.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      locationId: row.location_id,
      capacity: row.capacity,
      status: row.status,
      createdBy: row.created_by,
    }),
  );
}

export async function listLocations(): Promise<Location[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, kind, latitude, longitude, address, verified")
    .order("name");
  if (error) throw new Error(`Could not load locations: ${error.message}`);

  return (data ?? []).map((row) =>
    Location.parse({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) }),
  );
}
