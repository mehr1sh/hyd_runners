-- Coach and physiotherapist marketplace foundation.
--
-- * Services are listed only for professionals whose profile is verified,
--   listed and not suspended; physiotherapy services additionally require a
--   verified physiotherapist. Unverified professionals can prepare services
--   but nobody else sees them.
-- * Availability slots and booking requests: request → confirm or decline →
--   cancel or complete, with notifications and an audit trail.
-- * Payments are disabled. Every booking records payment_status
--   'not_collected'; no price is charged and no commission is taken. A
--   professional may show an indicative price, labelled as arranged directly.

create table public.professional_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles (user_id) on delete cascade,
  kind text not null check (kind in ('training_consultation', 'form_review', 'strength_programme', 'mobility_session',
                                     'race_preparation', 'physiotherapy')),
  title text not null check (char_length(title) between 3 and 100),
  description text check (description is null or char_length(description) <= 1000),
  duration_minutes smallint not null check (duration_minutes between 15 and 240),
  delivery text not null check (delivery in ('in_person', 'online')),
  indicative_price_inr integer check (indicative_price_inr is null or indicative_price_inr between 0 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index professional_services_pro_idx on public.professional_services (professional_id);

create function private.professional_is_bookable(p_pro uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.professional_profiles p
     where p.user_id = p_pro and p.verification_status = 'verified' and p.listed
       and (p_kind is distinct from 'physiotherapy' or p.profession = 'physiotherapist'));
$$;
revoke all on function private.professional_is_bookable(uuid, text) from public, anon;
grant execute on function private.professional_is_bookable(uuid, text) to authenticated;

create function private.services_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'physiotherapy' and not exists (
    select 1 from public.professional_profiles p where p.user_id = new.professional_id and p.profession = 'physiotherapist') then
    raise exception 'physiotherapy services are for physiotherapists' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger professional_services_guard before insert or update on public.professional_services
  for each row execute function private.services_guard();

alter table public.professional_services enable row level security;
revoke all on public.professional_services from anon, authenticated;
grant select, delete on public.professional_services to authenticated;
grant insert (professional_id, kind, title, description, duration_minutes, delivery, indicative_price_inr, active)
  on public.professional_services to authenticated;
grant update (title, description, duration_minutes, delivery, indicative_price_inr, active) on public.professional_services to authenticated;
create policy "professional_services: owner" on public.professional_services for all to authenticated
  using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));
create policy "professional_services: bookable listings" on public.professional_services for select to authenticated
  using (active and (select private.professional_is_bookable(professional_id, kind)));

create table public.professional_slots (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles (user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'held', 'booked', 'cancelled')),
  location_note text check (location_note is null or char_length(location_note) <= 120),
  created_at timestamptz not null default now(),
  constraint professional_slots_window check (ends_at > starts_at and ends_at <= starts_at + interval '4 hours')
);
create index professional_slots_pro_idx on public.professional_slots (professional_id, starts_at);

create function private.slots_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.enforce_rate_limit('professional_slot', 100, interval '1 day');
    if new.starts_at < now() then raise exception 'slots must be in the future' using errcode = '22023'; end if;
    new.status := 'open';
  end if;
  return new;
end;
$$;
create trigger professional_slots_guard before insert on public.professional_slots
  for each row execute function private.slots_guard();

alter table public.professional_slots enable row level security;
revoke all on public.professional_slots from anon, authenticated;
grant select, delete on public.professional_slots to authenticated;
grant insert (professional_id, starts_at, ends_at, location_note) on public.professional_slots to authenticated;
create policy "professional_slots: owner" on public.professional_slots for all to authenticated
  using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));
create policy "professional_slots: open slots of bookable professionals" on public.professional_slots for select to authenticated
  using (status = 'open' and starts_at > now() and (select private.professional_is_bookable(professional_id, null)));

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.professional_services (id) on delete restrict,
  slot_id uuid not null references public.professional_slots (id) on delete restrict,
  runner_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'declined', 'cancelled_by_runner', 'cancelled_by_professional', 'completed')),
  note text check (note is null or char_length(note) <= 500),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  payment_status text not null default 'not_collected' check (payment_status = 'not_collected'),
  acknowledged_boundaries boolean not null check (acknowledged_boundaries),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint bookings_not_self check (runner_id <> professional_id)
);
create index bookings_runner_idx on public.bookings (runner_id, created_at desc);
create index bookings_pro_idx on public.bookings (professional_id, created_at desc);
create unique index bookings_one_active_per_slot on public.bookings (slot_id) where status in ('requested', 'confirmed');

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;
create policy "bookings: participants" on public.bookings for select to authenticated
  using (runner_id = (select auth.uid()) or professional_id = (select auth.uid()));

create function public.request_booking(p_service uuid, p_slot uuid, p_note text, p_acknowledged boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  svc public.professional_services;
  sl public.professional_slots;
  new_id uuid;
  uid uuid := (select auth.uid());
begin
  if not coalesce(p_acknowledged, false) then
    raise exception 'please confirm you have read the boundaries' using errcode = '22023';
  end if;
  select * into svc from public.professional_services where id = p_service and active;
  if svc.id is null or not private.professional_is_bookable(svc.professional_id, svc.kind) then
    raise exception 'service not available' using errcode = 'P0002';
  end if;
  if svc.professional_id = uid then raise exception 'you cannot book yourself' using errcode = '22023'; end if;
  if private.is_blocked_between(uid, svc.professional_id) then raise exception 'not available' using errcode = '42501'; end if;
  perform private.enforce_rate_limit('booking_request', 10, interval '1 day');
  select * into sl from public.professional_slots
   where id = p_slot and professional_id = svc.professional_id and status = 'open' and starts_at > now()
   for update;
  if sl.id is null then raise exception 'that time is no longer free' using errcode = 'P0002'; end if;
  if sl.ends_at - sl.starts_at < make_interval(mins => svc.duration_minutes) then
    raise exception 'that slot is too short for this service' using errcode = '22023';
  end if;
  update public.professional_slots set status = 'held' where id = sl.id;
  insert into public.bookings (service_id, slot_id, runner_id, professional_id, note, acknowledged_boundaries)
  values (svc.id, sl.id, uid, svc.professional_id, nullif(left(btrim(coalesce(p_note, '')), 500), ''), true)
  returning id into new_id;
  perform private.write_audit('booking.requested', 'booking', new_id::text, svc.professional_id, '{}'::jsonb);
  perform private.notify(svc.professional_id, 'booking_request', 'New booking request: ' || svc.title, null, '/coach/services');
  return new_id;
end;
$$;

-- confirm / decline (professional), cancel (either), complete (professional, after the slot).
create function public.update_booking(p_booking uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  sl public.professional_slots;
  uid uuid := (select auth.uid());
  new_status text;
  slot_status text;
  notify_user uuid;
begin
  select * into b from public.bookings where id = p_booking and (runner_id = uid or professional_id = uid) for update;
  if b.id is null then raise exception 'booking not found' using errcode = 'P0002'; end if;
  select * into sl from public.professional_slots where id = b.slot_id for update;
  if p_action in ('confirm', 'decline') then
    if uid <> b.professional_id or b.status <> 'requested' then raise exception 'not possible' using errcode = '42501'; end if;
    if p_action = 'confirm' and not private.professional_is_bookable(b.professional_id, null) then
      raise exception 'your profile must be verified to accept bookings' using errcode = '42501';
    end if;
    new_status := case p_action when 'confirm' then 'confirmed' else 'declined' end;
    slot_status := case p_action when 'confirm' then 'booked' else 'open' end;
    notify_user := b.runner_id;
  elsif p_action = 'cancel' then
    if b.status not in ('requested', 'confirmed') or sl.starts_at <= now() then
      raise exception 'only upcoming bookings can be cancelled' using errcode = '22023';
    end if;
    new_status := case when uid = b.runner_id then 'cancelled_by_runner' else 'cancelled_by_professional' end;
    slot_status := 'open';
    notify_user := case when uid = b.runner_id then b.professional_id else b.runner_id end;
  elsif p_action = 'complete' then
    if uid <> b.professional_id or b.status <> 'confirmed' or sl.ends_at > now() then
      raise exception 'mark as completed after the session' using errcode = '22023';
    end if;
    new_status := 'completed';
    slot_status := 'booked';
    notify_user := null;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  update public.bookings set status = new_status, decided_at = now(),
         response_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), response_note)
   where id = b.id;
  update public.professional_slots set status = slot_status where id = sl.id and status <> 'cancelled';
  perform private.write_audit('booking.' || p_action, 'booking', b.id::text,
                              case when uid = b.runner_id then b.professional_id else b.runner_id end, '{}'::jsonb);
  if notify_user is not null then
    perform private.notify(notify_user, 'booking_update', 'Booking ' || replace(new_status, '_', ' '), null,
                           case when notify_user = b.runner_id then '/bookings' else '/coach/services' end);
  end if;
end;
$$;

revoke all on function public.request_booking(uuid, uuid, text, boolean), public.update_booking(uuid, text, text) from public, anon;
grant execute on function public.request_booking(uuid, uuid, text, boolean), public.update_booking(uuid, text, text) to authenticated;

-- Names and service titles for each side of a booking (profiles are not readable across runners).
create function public.my_bookings()
returns table (id uuid, status text, note text, response_note text, created_at timestamptz, starts_at timestamptz,
               ends_at timestamptz, location_note text, service_title text, delivery text, runner_id uuid, runner_name text,
               professional_id uuid, professional_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.status, b.note, b.response_note, b.created_at, s.starts_at, s.ends_at, s.location_note, v.title, v.delivery,
         b.runner_id, rp.display_name, b.professional_id, pp.display_name
  from public.bookings b
  join public.professional_slots s on s.id = b.slot_id
  join public.professional_services v on v.id = b.service_id
  join public.profiles rp on rp.id = b.runner_id
  join public.profiles pp on pp.id = b.professional_id
  where b.runner_id = (select auth.uid()) or b.professional_id = (select auth.uid())
  order by s.starts_at desc
  limit 200;
$$;

-- Directory: bookable professionals with their names.
create function public.professional_directory()
returns table (user_id uuid, display_name text, profession text, headline text, experience_years smallint,
               specializations text[], verified_at timestamptz, services bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, pr.display_name, p.profession, p.headline, p.experience_years, p.specializations, p.verified_at,
         (select count(*) from public.professional_services s where s.professional_id = p.user_id and s.active
            and private.professional_is_bookable(p.user_id, s.kind))
  from public.professional_profiles p join public.profiles pr on pr.id = p.user_id
  where private.professional_is_bookable(p.user_id, null)
    and not private.is_blocked_between(p.user_id, (select auth.uid()))
  order by pr.display_name
  limit 200;
$$;

revoke all on function public.my_bookings(), public.professional_directory() from public, anon;
grant execute on function public.my_bookings(), public.professional_directory() to authenticated;
