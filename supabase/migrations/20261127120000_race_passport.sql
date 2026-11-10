-- Race Passport and race-day tools.
--
-- * race_entries: a runner's planned, registered and past races, on HYD
--   Runners events or elsewhere: target, bib, wave, logistics checklist,
--   travel notes, a private emergency contact, results with their source,
--   and opt-in race-partner discovery. Owner-only; organisers never see
--   entries (they have their own RSVPs and results).
-- * Result sources: 'self_reported' (typed by the runner), 'imported_activity'
--   (taken from one of the runner's own activities) and 'organizer_verified'
--   (from event_results, never typed by a runner).
-- * QR check-in: each RSVP gets an unguessable check-in token; staff check a
--   runner in by scanning it (check_in_by_token).
-- * Organiser additions: volunteers with tasks on the event team, sponsors,
--   bulk results.

create table public.race_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  race_date date not null,
  distance text not null check (distance in ('5k', '10k', 'half', 'marathon', 'other')),
  distance_m integer not null check (distance_m between 1000 and 250000),
  city text check (city is null or char_length(city) <= 80),
  status text not null default 'planned' check (status in ('planned', 'registered', 'completed', 'dnf', 'dns', 'cancelled')),
  target_seconds integer check (target_seconds is null or target_seconds between 600 and 86400),
  bib text check (bib is null or char_length(bib) <= 20),
  wave text check (wave is null or char_length(wave) <= 40),
  checklist jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 40),
  travel_notes text check (travel_notes is null or char_length(travel_notes) <= 1000),
  emergency_name text check (emergency_name is null or char_length(emergency_name) <= 80),
  emergency_phone text check (emergency_phone is null or emergency_phone ~ '^\+?[0-9 ()-]{6,20}$'),
  result_seconds integer check (result_seconds is null or result_seconds between 60 and 172800),
  result_source text check (result_source in ('self_reported', 'imported_activity')),
  result_activity_id uuid references public.activities (id) on delete set null,
  reflection text check (reflection is null or char_length(reflection) <= 2000),
  find_partners boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint race_entries_result_source check ((result_seconds is null) = (result_source is null)),
  constraint race_entries_activity_source check ((result_source = 'imported_activity') = (result_activity_id is not null))
);
create unique index race_entries_event_once on public.race_entries (user_id, event_id) where event_id is not null;
create index race_entries_user_idx on public.race_entries (user_id, race_date desc);
create index race_entries_partners_idx on public.race_entries (event_id, race_date) where find_partners;
create trigger race_entries_updated_at before update on public.race_entries
  for each row execute function private.set_updated_at();

-- An imported result must be the runner's own ready activity; its time is the activity's.
create function private.race_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secs integer;
begin
  if tg_op = 'INSERT' then
    perform private.enforce_rate_limit('race_entry', 30, interval '1 day');
  end if;
  if new.result_activity_id is not null then
    select a.elapsed_seconds into secs from public.activities a
     where a.id = new.result_activity_id and a.user_id = new.user_id and a.status = 'ready';
    if secs is null then
      raise exception 'activity not found' using errcode = '42501';
    end if;
    new.result_seconds := secs;
    new.result_source := 'imported_activity';
  end if;
  if new.event_id is not null and not exists (select 1 from public.events e where e.id = new.event_id) then
    raise exception 'event not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger race_entries_guard before insert or update on public.race_entries
  for each row execute function private.race_entries_guard();

alter table public.race_entries enable row level security;
revoke all on public.race_entries from anon, authenticated;
grant select, delete on public.race_entries to authenticated;
grant insert (id, user_id, event_id, name, race_date, distance, distance_m, city, status, target_seconds, bib, wave, checklist,
              travel_notes, emergency_name, emergency_phone, result_seconds, result_source, result_activity_id, reflection,
              find_partners) on public.race_entries to authenticated;
grant update (name, race_date, city, status, target_seconds, bib, wave, checklist, travel_notes, emergency_name,
              emergency_phone, result_seconds, result_source, result_activity_id, reflection, find_partners)
  on public.race_entries to authenticated;
create policy "race_entries: owner" on public.race_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Race partners: other runners going to the same race who opted in, with a
-- target within 10% (or no target). Names, targets and level only.
create function public.race_partners(p_entry uuid)
returns table (user_id uuid, display_name text, target_seconds integer, fitness_level public.fitness_level)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select * from public.race_entries where id = p_entry and user_id = (select auth.uid()) and find_partners
  )
  select o.user_id, p.display_name, o.target_seconds, p.fitness_level
  from me
  join public.race_entries o on o.find_partners and o.user_id <> me.user_id and o.status in ('planned', 'registered')
   and o.distance = me.distance
   and ((me.event_id is not null and o.event_id = me.event_id)
        or (me.event_id is null and o.event_id is null and lower(o.name) = lower(me.name) and o.race_date = me.race_date))
  join public.profiles p on p.id = o.user_id
  where not private.is_blocked_between(me.user_id, o.user_id)
    and (me.target_seconds is null or o.target_seconds is null
         or abs(o.target_seconds - me.target_seconds) <= me.target_seconds * 0.1)
  order by abs(coalesce(o.target_seconds, me.target_seconds, 0) - coalesce(me.target_seconds, 0)), p.display_name
  limit 30;
$$;
revoke all on function public.race_partners(uuid) from public, anon;
grant execute on function public.race_partners(uuid) to authenticated;

-- QR check-in -----------------------------------------------------------------------

alter table public.event_rsvps add column checkin_token uuid not null default gen_random_uuid();
create unique index event_rsvps_checkin_token on public.event_rsvps (checkin_token);

create function public.check_in_by_token(p_event uuid, p_token uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.event_rsvps;
  who text;
begin
  if not private.can_staff_event(p_event) then
    raise exception 'Event team only' using errcode = '42501';
  end if;
  select * into r from public.event_rsvps where event_id = p_event and checkin_token = p_token;
  if r.user_id is null then
    raise exception 'This code is not for this event' using errcode = 'P0002';
  end if;
  perform public.check_in_attendee(p_event, r.user_id, true);
  select display_name into who from public.profiles where id = r.user_id;
  return who;
end;
$$;
revoke all on function public.check_in_by_token(uuid, uuid) from public, anon;
grant execute on function public.check_in_by_token(uuid, uuid) to authenticated;

-- Volunteers --------------------------------------------------------------------------

alter table public.event_team drop constraint event_team_role_check;
alter table public.event_team add constraint event_team_role_check
  check (role in ('organiser', 'captain', 'sweeper', 'volunteer'));
alter table public.event_team add column task text check (task is null or char_length(task) <= 120);
grant update (task) on public.event_team to authenticated;

-- Sponsors ------------------------------------------------------------------------------

create table public.event_sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 300)),
  tier text not null default 'supporter' check (tier in ('title', 'partner', 'supporter')),
  created_at timestamptz not null default now(),
  unique (event_id, name)
);
alter table public.event_sponsors enable row level security;
revoke all on public.event_sponsors from anon, authenticated;
grant select on public.event_sponsors to authenticated;
grant insert (event_id, name, url, tier), delete on public.event_sponsors to authenticated;
create policy "event_sponsors: visible with the event" on public.event_sponsors for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy "event_sponsors: organisers manage" on public.event_sponsors for all to authenticated
  using ((select private.can_manage_event(event_id))) with check ((select private.can_manage_event(event_id)));

-- Tokens are always generated by the database, never chosen by the caller.
create function private.event_rsvps_new_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.checkin_token := gen_random_uuid();
  return new;
end;
$$;
create trigger event_rsvps_new_token before insert on public.event_rsvps
  for each row execute function private.event_rsvps_new_token();

-- Organisers may add and remove volunteers (as they do captains and sweepers) and set tasks.
drop policy "event_team: add members" on public.event_team;
create policy "event_team: add members"
  on public.event_team for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and (
      (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or (role in ('captain', 'sweeper', 'volunteer') and (select private.event_team_role(event_id)) = 'organiser')
    )
  );
drop policy "event_team: remove members" on public.event_team;
create policy "event_team: remove members"
  on public.event_team for delete to authenticated
  using (
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
    or (role in ('captain', 'sweeper', 'volunteer') and (select private.event_team_role(event_id)) = 'organiser')
  );
create policy "event_team: organisers set tasks"
  on public.event_team for update to authenticated
  using ((select private.can_manage_event(event_id))) with check ((select private.can_manage_event(event_id)));
