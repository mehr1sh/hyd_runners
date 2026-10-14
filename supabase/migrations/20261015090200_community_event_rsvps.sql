-- Runner experience: RSVPs for the shared `events` table.
-- Owner: Runner experience (feat/runner-experience). Event management itself
-- (creating/editing events) stays with the foundation / management area.

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_rsvps_user_idx on public.event_rsvps (user_id);

create trigger event_rsvps_set_updated_at
  before update on public.event_rsvps
  for each row execute function private.set_updated_at();

-- Only published, not-yet-finished events accept RSVPs, and "going" RSVPs
-- never exceed capacity. The event row is locked so concurrent RSVPs for the
-- last place are serialised.
create function private.event_rsvp_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
  going integer;
begin
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.user_id <> old.user_id) then
    raise exception 'an RSVP cannot be moved' using errcode = '42501';
  end if;
  if new.status <> 'going' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'going' then
    return new;
  end if;

  select e.status, e.ends_at, e.capacity into ev
  from public.events e where e.id = new.event_id
  for update;

  if ev is null or ev.status <> 'published' or ev.ends_at <= now() then
    raise exception 'event is not open for RSVPs' using errcode = '23514';
  end if;

  if ev.capacity is not null then
    select count(*) into going from public.event_rsvps r
    where r.event_id = new.event_id and r.status = 'going' and r.user_id <> new.user_id;
    if going >= ev.capacity then
      raise exception 'event is full' using errcode = '23514', hint = 'event_full';
    end if;
  end if;
  return new;
end;
$$;

create trigger event_rsvps_guard
  before insert or update on public.event_rsvps
  for each row execute function private.event_rsvp_guard();

revoke all on public.event_rsvps from anon, authenticated;
grant select, insert on public.event_rsvps to authenticated;
-- event_id/user_id are listed because upserts re-assign them; the trigger forbids changes.
grant update (event_id, user_id, status) on public.event_rsvps to authenticated;

alter table public.event_rsvps enable row level security;

create policy "event_rsvps: read own" on public.event_rsvps for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "event_rsvps: create own" on public.event_rsvps for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "event_rsvps: update own" on public.event_rsvps for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Attendance counts for published events, without exposing who is going.
create function public.event_attendance(p_event_ids uuid[])
returns table (event_id uuid, going bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, count(r.user_id) filter (where r.status = 'going')
  from public.events e
  left join public.event_rsvps r on r.event_id = e.id
  where e.id = any (p_event_ids) and e.status = 'published'
  group by e.id;
$$;

revoke all on function public.event_attendance(uuid[]) from public;
grant execute on function public.event_attendance(uuid[]) to anon, authenticated;
