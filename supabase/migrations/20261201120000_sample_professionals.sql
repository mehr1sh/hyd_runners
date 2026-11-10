-- Sample professional profiles for local demo data.
--
-- The professional directory lists only verified, bookable professionals,
-- and that does not change. Local demo data needs to show what a coach's or
-- physiotherapist's profile looks like without marking anyone verified, so
-- this lists profiles of accounts flagged as demo accounts in
-- auth.users.raw_app_meta_data. Only the service role can set app metadata
-- (user metadata, which a user can edit, is ignored), and no production
-- account carries the flag, so in production this returns nothing.
--
-- Returned profiles are never verified and never bookable: the page shows
-- them in a separate "Sample profiles" section with their real status.

create or replace function public.sample_professionals()
returns table (
  user_id uuid,
  display_name text,
  profession text,
  headline text,
  experience_years smallint,
  specializations text[],
  verification_status text,
  services jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, pr.display_name, p.profession, p.headline, p.experience_years, p.specializations,
         p.verification_status,
         coalesce((
           select jsonb_agg(jsonb_build_object('title', s.title, 'kind', s.kind, 'durationMinutes', s.duration_minutes,
                                               'delivery', s.delivery) order by s.created_at, s.id)
           from public.professional_services s where s.professional_id = p.user_id and s.active), '[]'::jsonb)
  from public.professional_profiles p
  join public.profiles pr on pr.id = p.user_id
  join auth.users u on u.id = p.user_id
  where coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true'
    and p.listed
    and p.verification_status in ('unverified', 'pending')
    and not private.is_blocked_between(p.user_id, (select auth.uid()))
  order by pr.display_name
  limit 20;
$$;

revoke all on function public.sample_professionals() from public, anon;
grant execute on function public.sample_professionals() to authenticated;
