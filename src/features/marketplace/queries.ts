import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";

export type Booking = {
  id: string;
  status: keyof typeof import("./logic").BOOKING_STATUS;
  note: string | null;
  responseNote: string | null;
  startsAt: string;
  endsAt: string;
  locationNote: string | null;
  serviceTitle: string;
  delivery: string;
  runnerId: string;
  runnerName: string;
  professionalId: string;
  professionalName: string;
};

export async function myBookings(supabase: SupabaseClient): Promise<Booking[]> {
  const { data, error } = await supabase.rpc("my_bookings");
  if (error) throw new DatabaseQueryError("my_bookings", error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    status: r.status as Booking["status"],
    note: (r.note as string | null) ?? null,
    responseNote: (r.response_note as string | null) ?? null,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    locationNote: (r.location_note as string | null) ?? null,
    serviceTitle: r.service_title as string,
    delivery: r.delivery as string,
    runnerId: r.runner_id as string,
    runnerName: r.runner_name as string,
    professionalId: r.professional_id as string,
    professionalName: r.professional_name as string,
  }));
}

export async function directory(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("professional_directory");
  if (error) throw new DatabaseQueryError("professional_directory", error);
  return (data ?? []) as {
    user_id: string;
    display_name: string;
    profession: string;
    headline: string | null;
    experience_years: number | null;
    specializations: string[];
    verified_at: string | null;
    services: number;
  }[];
}

export async function professionalPage(supabase: SupabaseClient, id: string) {
  const [dir, profile, services, slots] = await Promise.all([
    directory(supabase),
    supabase
      .from("professional_profiles")
      .select("bio, credentials, verification_status, verified_at")
      .eq("user_id", id)
      .maybeSingle(),
    supabase
      .from("professional_services")
      .select("id, kind, title, description, duration_minutes, delivery, indicative_price_inr")
      .eq("professional_id", id)
      .eq("active", true),
    supabase
      .from("professional_slots")
      .select("id, starts_at, ends_at, location_note")
      .eq("professional_id", id)
      .eq("status", "open")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(30),
  ]);
  const entry = dir.find((d) => d.user_id === id);
  if (!entry || !profile.data || profile.data.verification_status !== "verified") return null;
  return {
    entry,
    bio: (profile.data.bio as string | null) ?? null,
    credentials: (profile.data.credentials as { name: string; issuer?: string; year?: number }[]) ?? [],
    services: (services.data ?? []) as {
      id: string;
      kind: string;
      title: string;
      description: string | null;
      duration_minutes: number;
      delivery: string;
      indicative_price_inr: number | null;
    }[],
    slots: (slots.data ?? []) as { id: string; starts_at: string; ends_at: string; location_note: string | null }[],
  };
}
