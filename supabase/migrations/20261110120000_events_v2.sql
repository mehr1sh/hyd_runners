-- Events v2 (Release 1, workstream A).
--
-- * Categories, meeting points and registration deadlines on events.
-- * Event-scoped teams: organisers (manage the event), captains and
--   sweepers (check people in). Being on an event team grants nothing
--   outside that event and is never a global role.
-- * Waiting lists: joining is explicit; a waiting-list request becomes a
--   place when one is free, and the oldest waiting runner is promoted
--   automatically when someone cancels or capacity grows.
-- * Check-in by the event team, pace groups, event announcements and
--   private results.
-- Existing events and RSVPs are preserved; every existing event becomes a
-- "group_run" unless it is one of the labelled sample events below.

-- ---------------------------------------------------------------------------
-- Events: new columns
-- ---------------------------------------------------------------------------

alter table public.events
  add column category text not null default 'group_run'
    check (category in ('group_run', 'race', 'beginner', 'social', 'workshop', 'training')),
  add column meeting_point text check (meeting_point is null or char_length(meeting_point) between 1 and 200),
  add column registration_closes_at timestamptz;

create index events_category_starts_idx on public.events (category, starts_at);
create index events_ends_at_idx on public.events (ends_at);

-- The labelled sample events (migration 20261108150000) for walk-runs and
-- beginners get the beginner category; nothing else changes.
update public.events
   set category = 'beginner'
 where id::text like '5eed0002-%'
   and (title ilike '%beginner%' or title ilike '%walk-run%' or title ilike '%walk run%');

-- ---------------------------------------------------------------------------
-- Event teams
-- ---------------------------------------------------------------------------

create table public.event_team (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('organiser', 'captain', 'sweeper')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

comment on table public.event_team is
  'Per-event roles. Organisers manage the event; captains and sweepers check people in. Not a global role.';

create index event_team_user_idx on public.event_team (user_id);

create function private.event_team_role(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.role from public.event_team t where t.event_id = p_event and t.user_id = (select auth.uid());
$$;

-- Managers, admins and the event's organisers may edit and run the event.
create function private.can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: no team role must mean false, never NULL (NULL slips past IF NOT).
  select coalesce(
    (select private.has_role('programme_manager'))
      or (select private.has_role('admin'))
      or private.event_team_role(p_event) = 'organiser',
    false);
$$;

-- Anyone on the event team (or a manager) may see the roster and check people in.
create function private.can_staff_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.can_manage_event(p_event) or private.event_team_role(p_event) in ('captain', 'sweeper'), false);
$$;

revoke all on function private.event_team_role(uuid) from public;
revoke all on function private.can_manage_event(uuid) from public;
revoke all on function private.can_staff_event(uuid) from public;
grant execute on function private.event_team_role(uuid) to authenticated;
grant execute on function private.can_manage_event(uuid) to authenticated;
grant execute on function private.can_staff_event(uuid) to authenticated;

revoke all on public.event_team from anon, authenticated;
grant select, insert, delete on public.event_team to authenticated;
alter table public.event_team enable row level security;

create policy "event_team: team and managers read"
  on public.event_team for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_staff_event(event_id)));

-- Managers add anyone in any role; organisers add captains and sweepers.
create policy "event_team: add members"
  on public.event_team for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and (
      (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or (role in ('captain', 'sweeper') and (select private.event_team_role(event_id)) = 'organiser')
    )
  );

create policy "event_team: remove members"
  on public.event_team for delete to authenticated
  using (
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
    or (role in ('captain', 'sweeper') and (select private.event_team_role(event_id)) = 'organiser')
  );

create function private.audit_event_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('event_team.added', 'event', new.event_id::text, new.user_id,
      jsonb_build_object('role', new.role));
    return new;
  end if;
  perform private.write_audit('event_team.removed', 'event', old.event_id::text, old.user_id,
    jsonb_build_object('role', old.role));
  return old;
end;
$$;

create trigger event_team_audit
  after insert or delete on public.event_team
  for each row execute function private.audit_event_team();

-- ---------------------------------------------------------------------------
-- Events: organisers edit their own events
-- ---------------------------------------------------------------------------

create policy "events: team reads own events"
  on public.events for select to authenticated
  using ((select private.can_staff_event(id)));

create policy "events: organisers update own events"
  on public.events for update to authenticated
  using ((select private.can_manage_event(id)))
  with check ((select private.can_manage_event(id)));

-- Authorship and identity never change through the API.
create function private.events_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if new.id <> old.id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'An event''s author and identity cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger events_guard_update
  before update on public.events
  for each row execute function private.events_guard_update();

-- Event teams for published events, shown on the event page: names and
-- roles for everyone; member ids only for the event team (to manage it).
create function public.event_team_members(p_event_id uuid)
returns table (display_name text, role text, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name, t.role, case when private.can_staff_event(e.id) then t.user_id end
  from public.event_team t
  join public.events e on e.id = t.event_id
  join public.profiles p on p.id = t.user_id
  where t.event_id = p_event_id
    and (e.status = 'published' or private.can_staff_event(e.id))
  order by case t.role when 'organiser' then 0 when 'captain' then 1 else 2 end, p.display_name;
$$;

revoke all on function public.event_team_members(uuid) from public, anon;
grant execute on function public.event_team_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pace groups
-- ---------------------------------------------------------------------------

create table public.event_pace_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  -- Seconds per kilometre; null bounds mean "no limit" (e.g. run-walk groups).
  min_pace_seconds integer check (min_pace_seconds is null or min_pace_seconds between 120 and 1200),
  max_pace_seconds integer check (max_pace_seconds is null or max_pace_seconds between 120 and 1200),
  run_walk boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 300),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint event_pace_groups_range check (
    min_pace_seconds is null or max_pace_seconds is null or min_pace_seconds < max_pace_seconds
  ),
  unique (event_id, label)
);

create index event_pace_groups_event_idx on public.event_pace_groups (event_id, sort_order);

revoke all on public.event_pace_groups from anon, authenticated;
grant select on public.event_pace_groups to anon, authenticated;
grant insert, update, delete on public.event_pace_groups to authenticated;
alter table public.event_pace_groups enable row level security;

create policy "event_pace_groups: read with event"
  on public.event_pace_groups for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id));

create policy "event_pace_groups: organisers write"
  on public.event_pace_groups for all to authenticated
  using ((select private.can_manage_event(event_id)))
  with check ((select private.can_manage_event(event_id)));

-- ---------------------------------------------------------------------------
-- RSVPs: waiting list, pace group, check-in
-- ---------------------------------------------------------------------------

alter table public.event_rsvps drop constraint event_rsvps_status_check;
alter table public.event_rsvps
  add constraint event_rsvps_status_check check (status in ('going', 'waitlisted', 'cancelled')),
  add column waitlisted_at timestamptz,
  add column promoted_at timestamptz,
  add column pace_group_id uuid references public.event_pace_groups (id) on delete set null,
  add column checked_in_at timestamptz,
  add column checked_in_by uuid references public.profiles (id) on delete set null;

create index event_rsvps_waitlist_idx on public.event_rsvps (event_id, waitlisted_at) where status = 'waitlisted';
create index event_rsvps_going_idx on public.event_rsvps (event_id) where status = 'going';

-- Runners may choose their own pace group; check-in columns are set only by
-- public.check_in_attendee().
grant update (pace_group_id) on public.event_rsvps to authenticated;

create policy "event_rsvps: team reads event rsvps"
  on public.event_rsvps for select to authenticated
  using ((select private.can_staff_event(event_id)));

-- Replaces the guard from 20261015100200. "going" still fails on a full
-- event; "waitlisted" becomes "going" when a place is free.
create or replace function private.event_rsvp_guard()
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

  if new.pace_group_id is not null and not exists (
    select 1 from public.event_pace_groups g where g.id = new.pace_group_id and g.event_id = new.event_id
  ) then
    raise exception 'That pace group belongs to another event' using errcode = '23514';
  end if;

  if new.status = 'cancelled' then
    new.waitlisted_at := null;
    return new;
  end if;
  -- Already holding a place, or staying on the waiting list.
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'going' then
    return new;
  end if;

  select e.status, e.ends_at, e.capacity, e.registration_closes_at into ev
  from public.events e where e.id = new.event_id
  for update;

  if ev is null or ev.status <> 'published' or ev.ends_at <= now()
     or (ev.registration_closes_at is not null and ev.registration_closes_at <= now()) then
    raise exception 'event is not open for RSVPs' using errcode = '23514';
  end if;

  select count(*) into going from public.event_rsvps r
  where r.event_id = new.event_id and r.status = 'going' and r.user_id <> new.user_id;

  if ev.capacity is null or going < ev.capacity then
    if new.status = 'waitlisted' then
      new.status := 'going';
    end if;
    new.waitlisted_at := null;
    return new;
  end if;

  if new.status = 'going' then
    raise exception 'event is full' using errcode = '23514', hint = 'event_full';
  end if;
  -- clock_timestamp: strict order even for joins in the same transaction.
  new.waitlisted_at := coalesce(new.waitlisted_at, clock_timestamp());
  return new;
end;
$$;

-- Fill free places from the waiting list, oldest first.
create function private.promote_waitlist(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
  going integer;
  next_id uuid;
begin
  select e.status, e.ends_at, e.capacity into ev from public.events e where e.id = p_event for update;
  if ev is null or ev.status <> 'published' or ev.ends_at <= now() then
    return;
  end if;
  loop
    select count(*) into going from public.event_rsvps r where r.event_id = p_event and r.status = 'going';
    exit when ev.capacity is not null and going >= ev.capacity;
    select r.user_id into next_id
      from public.event_rsvps r
     where r.event_id = p_event and r.status = 'waitlisted'
     order by r.waitlisted_at, r.created_at, r.user_id
     limit 1;
    exit when next_id is null;
    update public.event_rsvps
       set status = 'going', promoted_at = now()
     where event_id = p_event and user_id = next_id;
  end loop;
end;
$$;

revoke all on function private.promote_waitlist(uuid) from public, anon, authenticated;

create function private.promote_after_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'going' and new.status <> 'going' then
    perform private.promote_waitlist(new.event_id);
  end if;
  return new;
end;
$$;

create trigger event_rsvps_promote
  after update of status on public.event_rsvps
  for each row execute function private.promote_after_rsvp_change();

create function private.promote_after_capacity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.promote_waitlist(new.id);
  return new;
end;
$$;

create trigger events_promote_after_capacity
  after update of capacity on public.events
  for each row when (new.capacity is distinct from old.capacity)
  execute function private.promote_after_capacity_change();

-- Promotions are made on someone else's behalf, so they never count against
-- the canceller's RSVP rate limit (replaces the function from 20261109140000).
create or replace function private.rate_limit_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  case tg_table_name
    when 'messages' then
      perform private.enforce_rate_limit('message:burst', 20, interval '5 minutes');
      perform private.enforce_rate_limit('message:day', 300, interval '1 day');
    when 'feedback' then
      perform private.enforce_rate_limit('feedback:burst', 5, interval '1 hour');
      perform private.enforce_rate_limit('feedback:day', 20, interval '1 day');
    when 'feedback_replies' then
      perform private.enforce_rate_limit('feedback_reply:burst', 20, interval '10 minutes');
      perform private.enforce_rate_limit('feedback_reply:day', 200, interval '1 day');
    when 'timetable_uploads' then
      perform private.enforce_rate_limit('upload:burst', 10, interval '1 hour');
      perform private.enforce_rate_limit('upload:day', 30, interval '1 day');
    when 'event_rsvps' then
      if new.user_id is distinct from auth.uid() then
        return new;
      end if;
      -- An upsert fires BEFORE INSERT and then, on conflict, BEFORE UPDATE.
      -- Count it once: the insert path marks the row, the update path skips it.
      if tg_op = 'UPDATE' and current_setting('hyd.rsvp_counted', true) = new.event_id::text || ':' || new.user_id::text then
        perform set_config('hyd.rsvp_counted', '', true);
        return new;
      end if;
      perform private.enforce_rate_limit('rsvp:burst', 20, interval '10 minutes');
      perform private.enforce_rate_limit('rsvp:day', 100, interval '1 day');
      if tg_op = 'INSERT' then
        perform set_config('hyd.rsvp_counted', new.event_id::text || ':' || new.user_id::text, true);
      end if;
    else
      raise exception 'No rate limit defined for %', tg_table_name;
  end case;
  return new;
end;
$$;

-- Going and waiting-list counts for published events (no identities).
drop function public.event_attendance(uuid[]);
create function public.event_attendance(p_event_ids uuid[])
returns table (event_id uuid, going bigint, waitlisted bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id,
         count(r.user_id) filter (where r.status = 'going'),
         count(r.user_id) filter (where r.status = 'waitlisted')
  from public.events e
  left join public.event_rsvps r on r.event_id = e.id
  where e.id = any (p_event_ids) and e.status = 'published'
  group by e.id;
$$;

revoke all on function public.event_attendance(uuid[]) from public;
grant execute on function public.event_attendance(uuid[]) to anon, authenticated;

-- The caller's place on a waiting list (1 = next to be promoted).
create function public.my_waitlist_position(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*)::int + 1
    from public.event_rsvps o
    where o.event_id = p_event_id and o.status = 'waitlisted'
      and (o.waitlisted_at, o.created_at, o.user_id) < (me.waitlisted_at, me.created_at, me.user_id)
  )
  from public.event_rsvps me
  where me.event_id = p_event_id and me.user_id = (select auth.uid()) and me.status = 'waitlisted';
$$;

revoke all on function public.my_waitlist_position(uuid) from public, anon;
grant execute on function public.my_waitlist_position(uuid) to authenticated;

-- Roster with names, for the event team only.
create function public.event_roster(p_event_id uuid)
returns table (
  user_id uuid,
  display_name text,
  status text,
  pace_group_id uuid,
  waitlisted_at timestamptz,
  checked_in_at timestamptz,
  team_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_staff_event(p_event_id) then
    raise exception 'Event team only' using errcode = '42501';
  end if;
  return query
    select r.user_id, p.display_name, r.status, r.pace_group_id, r.waitlisted_at, r.checked_in_at, t.role
    from public.event_rsvps r
    join public.profiles p on p.id = r.user_id
    left join public.event_team t on t.event_id = r.event_id and t.user_id = r.user_id
    where r.event_id = p_event_id and r.status in ('going', 'waitlisted')
    order by r.status, p.display_name
    limit 1000;
end;
$$;

revoke all on function public.event_roster(uuid) from public, anon;
grant execute on function public.event_roster(uuid) to authenticated;

-- Check someone in (or undo it). Only for people with a place, from two hours
-- before the start until a day after the end.
create function public.check_in_attendee(p_event_id uuid, p_user_id uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
begin
  if not private.can_staff_event(p_event_id) then
    raise exception 'Event team only' using errcode = '42501';
  end if;
  select e.starts_at, e.ends_at into ev from public.events e where e.id = p_event_id;
  if now() < ev.starts_at - interval '2 hours' or now() > ev.ends_at + interval '1 day' then
    raise exception 'Check-in opens two hours before the start and closes a day after the end' using errcode = '22023';
  end if;
  update public.event_rsvps
     set checked_in_at = case when p_present then coalesce(checked_in_at, now()) else null end,
         checked_in_by = case when p_present then (select auth.uid()) else null end
   where event_id = p_event_id and user_id = p_user_id and status = 'going';
  if not found then
    raise exception 'That person does not have a place at this event' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.check_in_attendee(uuid, uuid, boolean) from public, anon;
grant execute on function public.check_in_attendee(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Event announcements
-- ---------------------------------------------------------------------------

create table public.event_updates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index event_updates_event_idx on public.event_updates (event_id, created_at desc);

revoke all on public.event_updates from anon, authenticated;
grant select on public.event_updates to authenticated;
grant insert, delete on public.event_updates to authenticated;
alter table public.event_updates enable row level security;

create policy "event_updates: read with event"
  on public.event_updates for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id));

create policy "event_updates: organisers post"
  on public.event_updates for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_manage_event(event_id)));

create policy "event_updates: organisers delete"
  on public.event_updates for delete to authenticated
  using ((select private.can_manage_event(event_id)));

-- ---------------------------------------------------------------------------
-- Results (private: the runner and the event team)
-- ---------------------------------------------------------------------------

create table public.event_results (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  outcome text not null check (outcome in ('finished', 'dnf', 'dns')),
  finish_seconds integer check (finish_seconds is null or finish_seconds between 60 and 86400),
  distance_meters integer check (distance_meters is null or distance_meters between 100 and 200000),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (event_id, user_id),
  constraint event_results_time_needs_finish check (finish_seconds is null or outcome = 'finished')
);

revoke all on public.event_results from anon, authenticated;
grant select, insert, update, delete on public.event_results to authenticated;
alter table public.event_results enable row level security;

create policy "event_results: runner and team read"
  on public.event_results for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_staff_event(event_id)));

create policy "event_results: organisers write"
  on public.event_results for all to authenticated
  using ((select private.can_manage_event(event_id)))
  with check ((select private.can_manage_event(event_id)) and recorded_by = (select auth.uid()));
