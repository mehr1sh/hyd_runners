-- Advanced group runs: pace-group leaders, opt-in live location sharing for
-- an organised run, help requests, a post-run recap and Run Radar.
--
-- Live location rules:
-- * Off by default. A runner shares only by starting a share for one
--   specific live session, for at most three hours, and can stop at any time.
-- * Only the latest position is kept. Stopping, expiry and the end of the
--   session delete it. Positions are never public: only the runner and the
--   event's organisers, captains and sweepers can read them, and only while
--   the share is active.
-- * Live sessions open at most an hour before the start and end within six
--   hours. This is a coordination aid, not an emergency service.

alter table public.event_pace_groups add column leader_id uuid references public.profiles (id) on delete set null;
grant update (leader_id) on public.event_pace_groups to authenticated;

create function private.pace_group_leader_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.leader_id is not null and not exists (
    select 1 from public.event_team t where t.event_id = new.event_id and t.user_id = new.leader_id) then
    raise exception 'pace group leaders must be on the event team' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger pace_group_leader_guard before insert or update of leader_id on public.event_pace_groups
  for each row execute function private.pace_group_leader_guard();

-- Live sessions ---------------------------------------------------------------------

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  constraint live_sessions_window check (ends_at > started_at and ends_at <= started_at + interval '6 hours')
);

create table public.live_shares (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stopped_at timestamptz,
  primary key (session_id, user_id),
  constraint live_shares_window check (expires_at > started_at and expires_at <= started_at + interval '3 hours')
);

create table public.live_positions (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.live_help_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  note text check (note is null or char_length(note) <= 300),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create index live_help_requests_session_idx on public.live_help_requests (session_id, created_at desc);

create function private.live_session_event(p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select event_id from public.live_sessions where id = p_session;
$$;
create function private.share_is_active(p_session uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.live_shares s join public.live_sessions l on l.id = s.session_id
     where s.session_id = p_session and s.user_id = p_user and s.stopped_at is null and s.expires_at > now()
       and l.ended_at is null and l.ends_at > now());
$$;
revoke all on function private.live_session_event(uuid), private.share_is_active(uuid, uuid) from public, anon;
grant execute on function private.live_session_event(uuid), private.share_is_active(uuid, uuid) to authenticated;

alter table public.live_sessions enable row level security;
alter table public.live_shares enable row level security;
alter table public.live_positions enable row level security;
alter table public.live_help_requests enable row level security;
revoke all on public.live_sessions, public.live_shares, public.live_positions, public.live_help_requests from anon, authenticated;
grant select on public.live_sessions, public.live_shares, public.live_positions, public.live_help_requests to authenticated;

-- Participants (going) and staff can see the session exists.
create policy "live_sessions: participants and staff" on public.live_sessions for select to authenticated
  using ((select private.can_staff_event(event_id))
         or exists (select 1 from public.event_rsvps r where r.event_id = live_sessions.event_id
                     and r.user_id = (select auth.uid()) and r.status = 'going'));
create policy "live_shares: own or staff" on public.live_shares for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_staff_event(private.live_session_event(session_id))));
create policy "live_positions: own, or staff while sharing" on public.live_positions for select to authenticated
  using (user_id = (select auth.uid())
         or ((select private.can_staff_event(private.live_session_event(session_id)))
             and private.share_is_active(session_id, user_id)));
create policy "live_help_requests: own or staff" on public.live_help_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_staff_event(private.live_session_event(session_id))));

create function public.start_live_session(p_event uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  sid uuid;
begin
  if not private.can_staff_event(p_event) then
    raise exception 'organisers, captains and sweepers start live sessions' using errcode = '42501';
  end if;
  select * into e from public.events where id = p_event and status = 'published';
  if e.id is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if now() < e.starts_at - interval '1 hour' or now() > e.ends_at then
    raise exception 'live sessions open an hour before the start and close at the end' using errcode = '22023';
  end if;
  insert into public.live_sessions (event_id, started_by, ends_at)
  values (p_event, (select auth.uid()), least(e.ends_at + interval '1 hour', now() + interval '6 hours'))
  on conflict (event_id) do nothing
  returning id into sid;
  if sid is null then
    select id into sid from public.live_sessions where event_id = p_event and ended_at is null and ends_at > now();
    if sid is null then raise exception 'this run''s live session has ended' using errcode = '22023'; end if;
  end if;
  perform private.write_audit('live.session_started', 'event', p_event::text, null, '{}'::jsonb);
  return sid;
end;
$$;

create function public.end_live_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_staff_event(private.live_session_event(p_session)) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update public.live_sessions set ended_at = now() where id = p_session and ended_at is null;
  update public.live_shares set stopped_at = coalesce(stopped_at, now()) where session_id = p_session;
  delete from public.live_positions where session_id = p_session;
  perform private.write_audit('live.session_ended', 'live_session', p_session::text, null, '{}'::jsonb);
end;
$$;

create function public.start_location_sharing(p_session uuid, p_minutes integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.live_sessions;
  until timestamptz;
begin
  select * into l from public.live_sessions where id = p_session and ended_at is null and ends_at > now();
  if l.id is null then raise exception 'live session not running' using errcode = 'P0002'; end if;
  if not (private.can_staff_event(l.event_id) or exists (
    select 1 from public.event_rsvps r where r.event_id = l.event_id and r.user_id = (select auth.uid()) and r.status = 'going')) then
    raise exception 'only participants share their location' using errcode = '42501';
  end if;
  until := least(now() + make_interval(mins => greatest(15, least(coalesce(p_minutes, 120), 180))), l.ends_at);
  insert into public.live_shares (session_id, user_id, started_at, expires_at)
  values (p_session, (select auth.uid()), now(), until)
  on conflict (session_id, user_id) do update set started_at = now(), expires_at = until, stopped_at = null;
  return until;
end;
$$;

create function public.stop_location_sharing(p_session uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.live_shares set stopped_at = now() where session_id = p_session and user_id = (select auth.uid()) and stopped_at is null;
  delete from public.live_positions where session_id = p_session and user_id = (select auth.uid());
$$;

create function public.update_live_position(p_session uuid, p_lat double precision, p_lon double precision,
                                            p_accuracy real, p_recorded_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_received timestamptz;
begin
  if not private.share_is_active(p_session, (select auth.uid())) then
    delete from public.live_positions where session_id = p_session and user_id = (select auth.uid());
    return 'not_sharing';
  end if;
  if p_recorded_at > now() + interval '1 minute' or p_recorded_at < now() - interval '10 minutes' then
    return 'stale';
  end if;
  select received_at into last_received from public.live_positions where session_id = p_session and user_id = (select auth.uid());
  if last_received is not null and last_received > now() - interval '5 seconds' then
    return 'throttled';
  end if;
  insert into public.live_positions (session_id, user_id, lat, lon, accuracy_m, recorded_at)
  values (p_session, (select auth.uid()), p_lat, p_lon, p_accuracy, p_recorded_at)
  on conflict (session_id, user_id) do update
    set lat = excluded.lat, lon = excluded.lon, accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at, received_at = now()
    where public.live_positions.recorded_at <= excluded.recorded_at;
  return 'ok';
end;
$$;

create function public.request_live_help(p_session uuid, p_note text, p_lat double precision, p_lon double precision)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.live_sessions;
  new_id uuid;
  ev text;
begin
  select * into l from public.live_sessions where id = p_session and ended_at is null;
  if l.id is null then raise exception 'live session not running' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.event_rsvps r where r.event_id = l.event_id and r.user_id = (select auth.uid()) and r.status = 'going')
     and not private.can_staff_event(l.event_id) then
    raise exception 'participants only' using errcode = '42501';
  end if;
  perform private.enforce_rate_limit('live_help', 10, interval '1 hour');
  insert into public.live_help_requests (session_id, user_id, note, lat, lon)
  values (p_session, (select auth.uid()), nullif(left(btrim(coalesce(p_note, '')), 300), ''), p_lat, p_lon)
  returning id into new_id;
  select title into ev from public.events where id = l.event_id;
  perform private.notify(t.user_id, 'live_help', 'A runner asked for help: ' || ev, nullif(left(btrim(coalesce(p_note, '')), 140), ''),
                         '/events/' || l.event_id || '/live')
    from public.event_team t where t.event_id = l.event_id;
  perform private.write_audit('live.help_requested', 'live_session', p_session::text, (select auth.uid()), '{}'::jsonb);
  return new_id;
end;
$$;

create function public.resolve_live_help(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.live_help_requests h set resolved_at = now(), resolved_by = (select auth.uid())
   where h.id = p_request and h.resolved_at is null
     and (h.user_id = (select auth.uid()) or private.can_staff_event(private.live_session_event(h.session_id)));
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
end;
$$;

-- Deletes positions whose share has stopped or expired, or whose session ended.
create function public.purge_stale_live_positions()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.live_positions p
     where not private.share_is_active(p.session_id, p.user_id)
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.start_live_session(uuid), public.end_live_session(uuid), public.start_location_sharing(uuid, integer),
  public.stop_location_sharing(uuid), public.update_live_position(uuid, double precision, double precision, real, timestamptz),
  public.request_live_help(uuid, text, double precision, double precision), public.resolve_live_help(uuid),
  public.purge_stale_live_positions() from public, anon;
grant execute on function public.start_live_session(uuid), public.end_live_session(uuid), public.start_location_sharing(uuid, integer),
  public.stop_location_sharing(uuid), public.update_live_position(uuid, double precision, double precision, real, timestamptz),
  public.request_live_help(uuid, text, double precision, double precision), public.resolve_live_help(uuid),
  public.purge_stale_live_positions() to authenticated;

-- Recap -------------------------------------------------------------------------------

-- Post-run recap for anyone who can see the event. Distance is an aggregate
-- of checked-in runners' own activities that started within the run's window,
-- shown only when at least three such activities exist (so no individual run
-- can be singled out).
create function public.group_run_recap(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.events;
  n_acts integer;
  total numeric;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not (e.status = 'published' or private.can_manage_event(p_event)) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  select count(*), coalesce(sum(a.distance_m), 0) into n_acts, total
    from public.event_rsvps r
    join public.activities a on a.user_id = r.user_id and a.status = 'ready'
     and a.started_at between e.starts_at - interval '30 minutes' and e.ends_at + interval '30 minutes'
   where r.event_id = p_event and r.checked_in_at is not null;
  return jsonb_build_object(
    'going', (select count(*) from public.event_rsvps where event_id = p_event and status = 'going'),
    'checkedIn', (select count(*) from public.event_rsvps where event_id = p_event and checked_in_at is not null),
    'finished', (select count(*) from public.event_results where event_id = p_event and outcome = 'finished'),
    'paceGroups', coalesce((select jsonb_agg(jsonb_build_object('label', g.label,
                    'checkedIn', (select count(*) from public.event_rsvps r where r.pace_group_id = g.id and r.checked_in_at is not null))
                    order by g.sort_order, g.label)
                  from public.event_pace_groups g where g.event_id = p_event), '[]'::jsonb),
    'activities', case when n_acts >= 3 then n_acts end,
    'distanceM', case when n_acts >= 3 then total end,
    'routeId', e.route_id,
    'ended', e.ends_at < now()
  );
end;
$$;
revoke all on function public.group_run_recap(uuid) from public, anon;
grant execute on function public.group_run_recap(uuid) to authenticated;

-- For the UI: is the caller staff for this event (organiser, captain, sweeper or manager)?
create function public.can_staff_live(p_event uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.can_staff_event(p_event);
$$;
revoke all on function public.can_staff_live(uuid) from public, anon;
grant execute on function public.can_staff_live(uuid) to authenticated;
