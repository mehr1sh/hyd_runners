-- Runner matching and micro-squads.
--
-- * matching_profiles: opt-in (off by default) running preferences with
--   coarse areas only (named Hyderabad neighbourhoods, never coordinates).
--   Nobody can read another runner's row; find_running_matches() returns
--   compatible opted-in, discoverable, unblocked runners with reasons.
-- * squads of 2–8 runners: captains, invites and join requests, a shared
--   calendar with attendance, group chat (reportable and moderated), weekly
--   collective target, consistency-first stats and the challenges members are
--   in. All squad data is visible to active members only.

alter type public.report_target add value if not exists 'squad_message';

create table public.matching_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  opted_in boolean not null default false,
  pace_min_s integer check (pace_min_s between 150 and 1200),
  pace_max_s integer check (pace_max_s between 150 and 1200),
  typical_km numeric(4, 1) check (typical_km between 1 and 60),
  areas text[] not null default '{}' check (cardinality(areas) <= 5 and array_to_string(areas, ',') ~ '^[a-z_,]*$'),
  days smallint[] not null default '{}' check (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  times public.time_of_day[] not null default '{}',
  goals text[] not null default '{}' check (goals <@ array['consistency', 'faster', 'longer', 'race', 'social', 'beginner_friendly']::text[]),
  experience public.fitness_level,
  group_size text not null default 'any' check (group_size in ('partner', 'small_group', 'any')),
  intro text check (intro is null or char_length(intro) <= 160),
  updated_at timestamptz not null default now(),
  constraint matching_pace_order check (pace_min_s is null or pace_max_s is null or pace_min_s <= pace_max_s)
);
create trigger matching_profiles_updated_at before update on public.matching_profiles
  for each row execute function private.set_updated_at();
alter table public.matching_profiles enable row level security;
revoke all on public.matching_profiles from anon, authenticated;
grant select, delete on public.matching_profiles to authenticated;
grant insert (user_id, opted_in, pace_min_s, pace_max_s, typical_km, areas, days, times, goals, experience, group_size, intro)
  on public.matching_profiles to authenticated;
grant update (opted_in, pace_min_s, pace_max_s, typical_km, areas, days, times, goals, experience, group_size, intro)
  on public.matching_profiles to authenticated;
create policy "matching_profiles: owner" on public.matching_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.match_dismissals (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  other_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, other_id)
);
alter table public.match_dismissals enable row level security;
revoke all on public.match_dismissals from anon, authenticated;
grant select, insert (user_id, other_id), delete on public.match_dismissals to authenticated;
create policy "match_dismissals: owner" on public.match_dismissals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Compatible runners for the caller, with reasons. Only opted-in, discoverable,
-- unblocked runners; coarse areas and rounded paces only.
create function public.find_running_matches(p_limit integer default 20)
returns table (user_id uuid, display_name text, score integer, reasons text[], intro text, shared_areas text[],
               pace_min_s integer, pace_max_s integer, group_size text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.* from public.matching_profiles m where m.user_id = (select auth.uid()) and m.opted_in
  ),
  cand as (
    select o.*, p.display_name as name,
      greatest(0, least(me.pace_max_s, o.pace_max_s) - greatest(me.pace_min_s, o.pace_min_s)) as pace_overlap,
      greatest(1, least(me.pace_max_s - me.pace_min_s, o.pace_max_s - o.pace_min_s)) as pace_span,
      array(select unnest(me.areas) intersect select unnest(o.areas)) as areas_shared,
      array(select unnest(me.days) intersect select unnest(o.days) order by 1) as days_shared,
      array(select unnest(me.times) intersect select unnest(o.times)) as times_shared,
      array(select unnest(me.goals) intersect select unnest(o.goals)) as goals_shared,
      me.typical_km as my_km, me.experience as my_exp, me.group_size as my_size
    from me
    join public.matching_profiles o on o.opted_in and o.user_id <> me.user_id
    join public.profiles p on p.id = o.user_id and p.discoverable
    where not private.is_blocked_between(me.user_id, o.user_id)
      and not exists (select 1 from public.match_dismissals d where d.user_id = me.user_id and d.other_id = o.user_id)
  ),
  scored as (
    select c.*,
      (case when c.pace_min_s is not null and c.pace_overlap > 0 then 30 * least(1, c.pace_overlap::numeric / c.pace_span) else 0 end
       + case when c.my_km is not null and c.typical_km is not null
                   and abs(c.my_km - c.typical_km) / greatest(c.my_km, c.typical_km) <= 0.3 then 15 else 0 end
       + least(20, 5 * coalesce(cardinality(c.days_shared), 0))
       + case when cardinality(c.times_shared) > 0 then 10 else 0 end
       + case when cardinality(c.areas_shared) > 0 then 20 else 0 end
       + case when cardinality(c.goals_shared) > 0 then 10 else 0 end
       + case when c.my_exp is not null and c.my_exp = c.experience then 5 else 0 end)::integer as s
    from cand c
    where c.my_size = 'any' or c.group_size = 'any' or c.my_size = c.group_size
  )
  select s.user_id, s.name, s.s,
    array_remove(array[
      case when s.pace_min_s is not null and s.pace_overlap > 0 then 'Similar pace' end,
      case when s.my_km is not null and s.typical_km is not null
                and abs(s.my_km - s.typical_km) / greatest(s.my_km, s.typical_km) <= 0.3 then 'Similar typical distance' end,
      case when cardinality(s.days_shared) > 0 then 'Runs on the same days (' || cardinality(s.days_shared) || ')' end,
      case when cardinality(s.times_shared) > 0 then 'Same time of day' end,
      case when cardinality(s.areas_shared) > 0 then 'Runs in the same area' end,
      case when cardinality(s.goals_shared) > 0 then 'Shared goals' end,
      case when s.my_exp is not null and s.my_exp = s.experience then 'Similar experience' end
    ], null),
    s.intro, s.areas_shared,
    (round(s.pace_min_s / 15.0) * 15)::integer, (round(s.pace_max_s / 15.0) * 15)::integer, s.group_size
  from scored s
  where s.s >= 25
  order by s.s desc, s.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.find_running_matches(integer) from public, anon;
grant execute on function public.find_running_matches(integer) to authenticated;

-- Squads ---------------------------------------------------------------------------

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 500),
  weekly_km_target numeric(5, 1) check (weekly_km_target between 1 and 1000),
  join_policy text not null default 'invite_only' check (join_policy in ('invite_only', 'request')),
  max_members smallint not null default 8 check (max_members between 2 and 8),
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.squad_members (
  squad_id uuid not null references public.squads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('captain', 'member')),
  status text not null check (status in ('invited', 'requested', 'active')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);
create index squad_members_user_idx on public.squad_members (user_id);

create function private.is_squad_member(p_squad uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.squad_members m
                  where m.squad_id = p_squad and m.user_id = (select auth.uid()) and m.status = 'active');
$$;
create function private.is_squad_captain(p_squad uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.squad_members m
                  where m.squad_id = p_squad and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'captain');
$$;
revoke all on function private.is_squad_member(uuid), private.is_squad_captain(uuid) from public, anon;
grant execute on function private.is_squad_member(uuid), private.is_squad_captain(uuid) to authenticated;

alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
revoke all on public.squads, public.squad_members from anon, authenticated;
grant select on public.squads, public.squad_members to authenticated;
grant update (name, description, weekly_km_target, join_policy, max_members) on public.squads to authenticated;
-- Members, invitees and requesters see the squad; open-to-request squads are findable.
create policy "squads: members, invitees or open" on public.squads for select to authenticated
  using (archived_at is null and (join_policy = 'request'
         or exists (select 1 from public.squad_members m where m.squad_id = id and m.user_id = (select auth.uid())))
         or (select private.is_squad_member(id)));
create policy "squads: captains edit" on public.squads for update to authenticated
  using ((select private.is_squad_captain(id))) with check ((select private.is_squad_captain(id)));
create policy "squad_members: members see the roster, people see their own row" on public.squad_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_squad_member(squad_id)));

create function public.create_squad(p_name text, p_description text, p_weekly_km numeric, p_join_policy text, p_max integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  perform private.enforce_rate_limit('squad_create', 5, interval '1 day');
  if (select count(*) from public.squad_members where user_id = (select auth.uid()) and status = 'active') >= 5 then
    raise exception 'you can be in at most five squads' using errcode = '22023';
  end if;
  insert into public.squads (name, description, weekly_km_target, join_policy, max_members, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_weekly_km, coalesce(p_join_policy, 'invite_only'),
          coalesce(p_max, 8), (select auth.uid()))
  returning id into new_id;
  insert into public.squad_members (squad_id, user_id, role, status, joined_at)
  values (new_id, (select auth.uid()), 'captain', 'active', now());
  return new_id;
end;
$$;

-- Every membership change goes through here: invite, request, accept,
-- approve, decline, leave, remove, make_captain.
create function public.squad_membership(p_squad uuid, p_user uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sq public.squads;
  row_ public.squad_members;
  active_count integer;
begin
  select * into sq from public.squads where id = p_squad and archived_at is null;
  if sq.id is null or uid is null then
    raise exception 'squad not found' using errcode = 'P0002';
  end if;
  select * into row_ from public.squad_members where squad_id = p_squad and user_id = p_user;
  select count(*) into active_count from public.squad_members where squad_id = p_squad and status = 'active';

  if p_action = 'invite' then
    if not private.is_squad_captain(p_squad) then raise exception 'captains invite' using errcode = '42501'; end if;
    if row_.user_id is not null then raise exception 'already invited or a member' using errcode = '23505'; end if;
    if private.is_blocked_between(uid, p_user) or not exists (select 1 from public.profiles where id = p_user) then
      raise exception 'cannot invite this runner' using errcode = '42501';
    end if;
    perform private.enforce_rate_limit('squad_invite', 30, interval '1 day');
    insert into public.squad_members (squad_id, user_id, status, invited_by) values (p_squad, p_user, 'invited', uid);
    perform private.notify(p_user, 'squad_invite', 'You''re invited to join ' || sq.name, null, '/squads');
  elsif p_action = 'request' then
    if p_user <> uid or sq.join_policy <> 'request' then raise exception 'cannot request' using errcode = '42501'; end if;
    if row_.user_id is not null then raise exception 'already invited or a member' using errcode = '23505'; end if;
    perform private.enforce_rate_limit('squad_request', 20, interval '1 day');
    insert into public.squad_members (squad_id, user_id, status) values (p_squad, uid, 'requested');
    perform private.notify(m.user_id, 'squad_request', 'Someone asked to join ' || sq.name, null, '/squads/' || p_squad)
      from public.squad_members m where m.squad_id = p_squad and m.role = 'captain' and m.status = 'active';
  elsif p_action in ('accept', 'approve') then
    if p_action = 'accept' and (p_user <> uid or row_.status is distinct from 'invited') then
      raise exception 'no invitation' using errcode = '42501';
    end if;
    if p_action = 'approve' and (not private.is_squad_captain(p_squad) or row_.status is distinct from 'requested') then
      raise exception 'no request to approve' using errcode = '42501';
    end if;
    if active_count >= sq.max_members then raise exception 'the squad is full' using errcode = '22023'; end if;
    if (select count(*) from public.squad_members where user_id = p_user and status = 'active') >= 5 then
      raise exception 'runners can be in at most five squads' using errcode = '22023';
    end if;
    update public.squad_members set status = 'active', joined_at = now() where squad_id = p_squad and user_id = p_user;
    if p_action = 'approve' then
      perform private.notify(p_user, 'squad_joined', 'You''re in: ' || sq.name, null, '/squads/' || p_squad);
    end if;
  elsif p_action in ('decline', 'leave') then
    if p_user <> uid or row_.user_id is null then raise exception 'not a member' using errcode = '42501'; end if;
    if row_.role = 'captain' and row_.status = 'active' and not exists (
      select 1 from public.squad_members where squad_id = p_squad and role = 'captain' and status = 'active' and user_id <> uid)
       and active_count > 1 then
      raise exception 'make someone else captain before leaving' using errcode = '22023';
    end if;
    delete from public.squad_members where squad_id = p_squad and user_id = uid;
    if active_count <= 1 and row_.status = 'active' then
      update public.squads set archived_at = now() where id = p_squad;
    end if;
  elsif p_action = 'remove' then
    if not private.is_squad_captain(p_squad) or p_user = uid or row_.user_id is null then
      raise exception 'captains remove other members' using errcode = '42501';
    end if;
    delete from public.squad_members where squad_id = p_squad and user_id = p_user;
    perform private.write_audit('squad.member_removed', 'squad', p_squad::text, p_user, '{}'::jsonb);
  elsif p_action = 'make_captain' then
    if not private.is_squad_captain(p_squad) or row_.status is distinct from 'active' then
      raise exception 'captains appoint captains' using errcode = '42501';
    end if;
    update public.squad_members set role = 'captain' where squad_id = p_squad and user_id = p_user;
    perform private.write_audit('squad.captain_appointed', 'squad', p_squad::text, p_user, '{}'::jsonb);
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.create_squad(text, text, numeric, text, integer), public.squad_membership(uuid, uuid, text) from public, anon;
grant execute on function public.create_squad(text, text, numeric, text, integer), public.squad_membership(uuid, uuid, text) to authenticated;

-- Chat -----------------------------------------------------------------------------

create table public.squad_messages (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000 and body = btrim(body)),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null
);
create index squad_messages_squad_idx on public.squad_messages (squad_id, created_at desc);
create function private.squad_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('squad_message', 60, interval '1 hour');
  new.author_id := (select auth.uid());
  new.created_at := now();
  new.hidden_at := null;
  new.hidden_by := null;
  return new;
end;
$$;
create trigger squad_messages_before_insert before insert on public.squad_messages
  for each row execute function private.squad_messages_before_insert();
alter table public.squad_messages enable row level security;
revoke all on public.squad_messages from anon, authenticated;
grant select, delete on public.squad_messages to authenticated;
grant insert (id, squad_id, body) on public.squad_messages to authenticated;
create policy "squad_messages: members read" on public.squad_messages for select to authenticated
  using ((select private.is_squad_member(squad_id)) and (hidden_at is null or author_id = (select auth.uid())));
create policy "squad_messages: members write" on public.squad_messages for insert to authenticated
  with check ((select private.is_squad_member(squad_id)));
create policy "squad_messages: authors delete" on public.squad_messages for delete to authenticated
  using (author_id = (select auth.uid()));

-- Shared calendar ------------------------------------------------------------------

create table public.squad_runs (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  starts_at timestamptz not null,
  meeting_point text not null check (char_length(meeting_point) between 2 and 120),
  location_id uuid references public.locations (id) on delete set null,
  route_id uuid references public.routes (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index squad_runs_squad_idx on public.squad_runs (squad_id, starts_at);
create table public.squad_run_attendance (
  run_id uuid not null references public.squad_runs (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'attended', 'not_going')),
  updated_at timestamptz not null default now(),
  primary key (run_id, user_id)
);
create function private.squad_runs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('squad_run', 30, interval '1 day');
  new.created_by := (select auth.uid());
  if new.starts_at < now() - interval '1 hour' then
    raise exception 'runs must be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger squad_runs_before_insert before insert on public.squad_runs
  for each row execute function private.squad_runs_before_insert();
-- Attendance can be marked "attended" only once the run has started.
create function private.squad_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'attended' and (select starts_at from public.squad_runs where id = new.run_id) > now() then
    raise exception 'mark attendance after the run starts' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger squad_attendance_guard before insert or update on public.squad_run_attendance
  for each row execute function private.squad_attendance_guard();

alter table public.squad_runs enable row level security;
alter table public.squad_run_attendance enable row level security;
revoke all on public.squad_runs, public.squad_run_attendance from anon, authenticated;
grant select, delete on public.squad_runs to authenticated;
grant insert (id, squad_id, title, starts_at, meeting_point, location_id, route_id, notes) on public.squad_runs to authenticated;
grant select, delete on public.squad_run_attendance to authenticated;
grant insert (run_id, user_id, status), update (status) on public.squad_run_attendance to authenticated;
create policy "squad_runs: members read" on public.squad_runs for select to authenticated
  using ((select private.is_squad_member(squad_id)));
create policy "squad_runs: members add" on public.squad_runs for insert to authenticated
  with check ((select private.is_squad_member(squad_id)));
create policy "squad_runs: creator or captain deletes" on public.squad_runs for delete to authenticated
  using (created_by = (select auth.uid()) or (select private.is_squad_captain(squad_id)));
create policy "squad_run_attendance: members read" on public.squad_run_attendance for select to authenticated
  using (exists (select 1 from public.squad_runs r where r.id = run_id));
create policy "squad_run_attendance: own" on public.squad_run_attendance for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.squad_runs r where r.id = run_id));

-- Dashboard: consistency first. Weekly totals per member for this week and
-- the last eight weeks, attendance, collective target streak and the
-- challenges members have joined (with progress from the challenge engine).
create function public.squad_dashboard(p_squad uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sq public.squads;
  tz text := 'Asia/Kolkata';
  this_week date := date_trunc('week', now() at time zone tz)::date;
begin
  if not private.is_squad_member(p_squad) then
    raise exception 'members only' using errcode = '42501';
  end if;
  select * into sq from public.squads where id = p_squad;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id, 'name', p.display_name, 'role', m.role,
        'weekKm', round(coalesce((select sum(a.distance_m) from public.activities a where a.user_id = m.user_id and a.status = 'ready'
                         and a.started_at >= (this_week::timestamp at time zone tz)), 0) / 1000, 1),
        'weekActiveDays', (select count(distinct (a.started_at at time zone tz)::date) from public.activities a
                            where a.user_id = m.user_id and a.status = 'ready' and a.started_at >= (this_week::timestamp at time zone tz)),
        'attended', (select count(*) from public.squad_run_attendance t join public.squad_runs r on r.id = t.run_id
                      where r.squad_id = p_squad and t.user_id = m.user_id and t.status = 'attended')
      ) order by p.display_name)
      from public.squad_members m join public.profiles p on p.id = m.user_id
      where m.squad_id = p_squad and m.status = 'active'), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('weekStart', w, 'km', round(km / 1000, 1), 'activeMembers', am) order by w)
      from (
        select gs::date w,
               coalesce((select sum(a.distance_m) from public.activities a join public.squad_members m on m.user_id = a.user_id
                          where m.squad_id = p_squad and m.status = 'active' and a.status = 'ready'
                            and a.started_at >= (gs::timestamp at time zone tz)
                            and a.started_at < ((gs + interval '7 days')::timestamp at time zone tz)), 0) km,
               (select count(distinct a.user_id) from public.activities a join public.squad_members m on m.user_id = a.user_id
                 where m.squad_id = p_squad and m.status = 'active' and a.status = 'ready'
                   and a.started_at >= (gs::timestamp at time zone tz)
                   and a.started_at < ((gs + interval '7 days')::timestamp at time zone tz)) am
        from generate_series(this_week - 56, this_week, interval '7 days') gs
      ) x), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'goal', c.goal, 'endsAt', c.ends_at,
        'members', (select jsonb_agg(jsonb_build_object('name', p.display_name,
                       'progress', (private.challenge_progress(c, cp.user_id)), 'completed', cp.completed_at is not null))
                     from public.challenge_participants cp join public.squad_members m on m.user_id = cp.user_id
                     join public.profiles p on p.id = cp.user_id
                     where cp.challenge_id = c.id and m.squad_id = p_squad and m.status = 'active')))
      from public.challenges c
      where c.status = 'active' and c.ends_at > now()
        and private.can_see_challenge(c.scope, c.club_id, c.status)
        and exists (select 1 from public.challenge_participants cp join public.squad_members m on m.user_id = cp.user_id
                     where cp.challenge_id = c.id and m.squad_id = p_squad and m.status = 'active')), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.squad_dashboard(uuid) from public, anon;
grant execute on function public.squad_dashboard(uuid) to authenticated;

-- Moderation: squad messages can be reported, viewed by moderators and hidden.
-- (Latest definitions from 20261118120000_social_v1 with the squad_message case added.)

create or replace function public.report_content(
  p_target_type public.report_target,
  p_target_id uuid,
  p_reason public.report_reason,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  author uuid;
  new_id uuid;
  clean_details text := nullif(btrim(p_details), '');
begin
  if uid is null then
    raise exception 'Sign in to report content' using errcode = '42501';
  end if;

  if p_target_type = 'message' then
    -- Only the recipient reports a message.
    select m.sender_id into author
      from public.messages m
     where m.id = p_target_id and m.recipient_id = uid and m.hidden_at is null;
  elsif p_target_type = 'feedback_reply' then
    select r.author_id into author
      from public.feedback_replies r
      join public.feedback f on f.id = r.feedback_id
     where r.id = p_target_id
       and r.hidden_at is null
       and (
         f.user_id = uid
         or (f.assigned_to = uid and private.holds_assignee_role(uid))
         or private.is_moderator()
       );
  elsif p_target_type = 'feedback' then
    -- Staff who can see a feedback item may report it.
    select f.user_id into author
      from public.feedback f
     where f.id = p_target_id
       and ((f.assigned_to = uid and private.holds_assignee_role(uid)) or private.is_moderator());
  elsif p_target_type::text = 'activity' then
    -- Anyone who can see the activity may report it.
    select a.user_id into author
      from public.activities a
     where a.id = p_target_id and a.status = 'ready' and a.hidden_at is null
       and private.can_view_activity(a.user_id, a.visibility);
  elsif p_target_type::text = 'squad_message' then
    -- Fellow active squad members may report a message.
    select m.author_id into author
      from public.squad_messages m
     where m.id = p_target_id and m.hidden_at is null and private.is_squad_member(m.squad_id);
  elsif p_target_type::text = 'activity_comment' then
    select c.author_id into author
      from public.activity_comments c
      join public.activities a on a.id = c.activity_id
     where c.id = p_target_id and c.hidden_at is null
       and not private.is_blocked_between(c.author_id, uid)
       and private.can_view_activity(a.user_id, a.visibility);
  end if;

  if author is null or author = uid then
    raise exception 'That content cannot be reported' using errcode = '42501';
  end if;

  if clean_details is not null and char_length(clean_details) > 1000 then
    raise exception 'Details must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.content_reports cr
     where cr.reporter_id = uid and cr.target_type = p_target_type and cr.target_id = p_target_id
  ) then
    raise exception 'You have already reported this' using errcode = '23505';
  end if;

  perform private.enforce_rate_limit('content_report', 10, interval '1 hour');

  insert into public.content_reports (reporter_id, target_type, target_id, subject_id, reason, details)
  values (uid, p_target_type, p_target_id, author, p_reason, clean_details)
  returning id into new_id;

  perform private.write_audit('report.submitted', 'content_report', new_id::text, author,
    jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', p_reason));
  return new_id;
end;
$$;

create or replace function public.moderation_report_content(p_report_id uuid)
returns table (
  target_type public.report_target,
  body text,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  hidden_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  report public.content_reports%rowtype;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  perform private.write_audit('report.content_viewed', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('target_type', report.target_type, 'target_id', report.target_id));

  if report.target_type = 'message' then
    return query
      select report.target_type, m.body, m.sender_id, p.display_name, m.created_at, m.hidden_at
        from public.messages m
        left join public.profiles p on p.id = m.sender_id
       where m.id = report.target_id;
  elsif report.target_type = 'feedback_reply' then
    return query
      select report.target_type, r.body, r.author_id, p.display_name, r.created_at, r.hidden_at
        from public.feedback_replies r
        left join public.profiles p on p.id = r.author_id
       where r.id = report.target_id;
  elsif report.target_type::text = 'activity' then
    -- The activity's name and summary only, never its track.
    return query
      select report.target_type,
             coalesce(a.name, '(untitled ' || a.activity_type || ')') || ' · '
               || round(coalesce(a.distance_m, 0) / 1000, 2) || ' km · visibility ' || a.visibility,
             a.user_id, p.display_name, a.created_at, a.hidden_at
        from public.activities a
        left join public.profiles p on p.id = a.user_id
       where a.id = report.target_id;
  elsif report.target_type::text = 'squad_message' then
    return query
      select report.target_type, m.body, m.author_id, p.display_name, m.created_at, m.hidden_at
        from public.squad_messages m
        left join public.profiles p on p.id = m.author_id
       where m.id = report.target_id;
  elsif report.target_type::text = 'activity_comment' then
    return query
      select report.target_type, c.body, c.author_id, p.display_name, c.created_at, c.hidden_at
        from public.activity_comments c
        left join public.profiles p on p.id = c.author_id
       where c.id = report.target_id;
  else
    return query
      select report.target_type, f.body, f.user_id, p.display_name, f.created_at, null::timestamptz
        from public.feedback f
        left join public.profiles p on p.id = f.user_id
       where f.id = report.target_id;
  end if;
end;
$$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_decision public.report_decision,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  report public.content_reports%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  new_status public.report_status := case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if report.status <> 'open' then
    raise exception 'This report has already been resolved' using errcode = '55000';
  end if;
  if report.subject_id = uid or report.reporter_id = uid then
    raise exception 'Another moderator must resolve a report you are part of' using errcode = '42501';
  end if;
  if p_decision = 'hide_content' and report.target_type = 'feedback' then
    raise exception 'Feedback items cannot be hidden; uphold or dismiss the report' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if p_decision = 'hide_content' then
    if report.target_type = 'message' then
      update public.messages set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('message.hidden', 'message', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    elsif report.target_type::text = 'squad_message' then
      update public.squad_messages set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('squad_message.hidden', 'squad_message', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    elsif report.target_type::text = 'activity' then
      update public.activities set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('activity.hidden', 'activity', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    elsif report.target_type::text = 'activity_comment' then
      update public.activity_comments set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('activity_comment.hidden', 'activity_comment', report.target_id::text,
        report.subject_id, jsonb_build_object('report_id', report.id));
    else
      update public.feedback_replies set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('feedback_reply.hidden', 'feedback_reply', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    end if;
  end if;

  update public.content_reports cr
     set status = new_status, decision = p_decision, resolution_note = clean_note,
         resolved_by = uid, resolved_at = now()
   where cr.id = report.id
      or (p_decision = 'hide_content' and cr.status = 'open'
          and cr.target_type = report.target_type and cr.target_id = report.target_id);

  perform private.write_audit('report.resolved', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('decision', p_decision, 'target_type', report.target_type, 'target_id', report.target_id));
end;
$$;
