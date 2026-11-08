import { z } from "zod";
import { fail } from "@/lib/api/response";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { buildIcs } from "@/features/events/logic";

/** GET /events/:id/calendar — an .ics file for a published event (RLS decides visibility). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured || !z.uuid().safeParse(id).success) return fail("not_found", "Event not found.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, description, starts_at, ends_at, meeting_point, status, locations(name, address)")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (error) {
    console.error("[events] calendar export failed", error.code);
    return fail("internal_error", "Could not build the calendar file.");
  }
  if (!data) return fail("not_found", "Event not found.");
  const place = data.locations as unknown as { name: string; address: string | null } | null;
  const location = [data.meeting_point, place?.name, place?.address].filter(Boolean).join(", ") || null;
  const site = publicEnv.NEXT_PUBLIC_SITE_URL ?? "https://hydrunners.vercel.app";
  const body = buildIcs({
    id: data.id,
    title: data.title,
    description: data.description ?? "",
    startsAt: new Date(data.starts_at).toISOString(),
    endsAt: new Date(data.ends_at).toISOString(),
    location,
    url: `${site.replace(/\/$/, "")}/events/${data.id}`,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="hyd-runners-event.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
