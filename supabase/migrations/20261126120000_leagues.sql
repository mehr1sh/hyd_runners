-- Leagues: club, university, corporate, city-wide, seasonal, beginner and
-- consistency competitions with teams, transparent scoring and history.
--
-- * Leagues are created by programme managers or admins; each league has
--   its own league admins. Changes to leagues and teams are audited.
-- * Teams may be tied to a club (members must be active club members) or be
--   named teams joined with a code (university, corporate, custom).
-- * A runner is in at most one team per league.
-- * Scoring never rewards speed. Points come from: active days, consistent
--   weeks (3+ active days), group-run check-ins, distance (per 5 km, capped
--   at 50 km a day per runner), completed challenges and finished events,
--   each with a published weight. Only activities with status 'ready' count;
--   import duplicate detection already prevents double imports, and active
--   days are counted once per day.
-- * Leaderboards respect runner_settings.show_on_leaderboard: hidden
--   runners still count for their team but are never named.

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  kind text not null check (kind in ('club', 'university', 'corporate', 'city', 'seasonal', 'beginner', 'consistency')),
  description text check (description is null or char_length(description) <= 1000),
  starts_on date not null,
  ends_on date not null,
  timezone text not null default 'Asia/Kolkata',
  -- Points per unit; the scoring rules shown to everyone.
  scoring jsonb not null default '{"active_day": 10, "consistent_week": 25, "group_run": 15, "per_5km": 5, "challenge": 20, "event": 30}'::jsonb,
  team_size_max smallint not null default 50 check (team_size_max between 2 and 500),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_dates check (ends_on >= starts_on and ends_on <= starts_on + 366),
  constraint leagues_scoring_keys check (
    jsonb_typeof(scoring) = 'object'
    and scoring - array['active_day', 'consistent_week', 'group_run', 'per_5km', 'challenge', 'event'] = '{}'::jsonb)
);
create trigger leagues_updated_at before update on public.leagues
  for each row execute function private.set_updated_at();

create function private.leagues_validate_scoring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_each(new.scoring) e(k, v)
              where jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 100) then
    raise exception 'scoring weights must be numbers from 0 to 100' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger leagues_validate_scoring before insert or update of scoring on public.leagues
  for each row execute function private.leagues_validate_scoring();

create table public.league_admins (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (league_id, user_id)
);

create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  affiliation text not null default 'custom' check (affiliation in ('club', 'university', 'corporate', 'custom')),
  club_id uuid references public.clubs (id) on delete set null,
  join_code text check (join_code is null or join_code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now(),
  unique (league_id, name),
  constraint league_teams_club check ((affiliation = 'club') = (club_id is not null))
);
create unique index league_teams_code on public.league_teams (league_id, join_code) where join_code is not null;

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.league_teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index league_members_team_idx on public.league_members (team_id);

create function private.is_league_admin(p_league uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin') or private.has_role('programme_manager')
      or exists (select 1 from public.league_admins a where a.league_id = p_league and a.user_id = (select auth.uid()));
$$;
revoke all on function private.is_league_admin(uuid) from public, anon;
grant execute on function private.is_league_admin(uuid) to authenticated;

create function private.audit_leagues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit('league.' || lower(tg_op), tg_table_name, coalesce(new.id, old.id)::text, null,
    jsonb_build_object('name', coalesce(new.name, old.name)));
  return coalesce(new, old);
end;
$$;
create trigger leagues_audit after insert or update or delete on public.leagues
  for each row execute function private.audit_leagues();
create trigger league_teams_audit after insert or update or delete on public.league_teams
  for each row execute function private.audit_leagues();

create function private.leagues_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  new.status := 'draft';
  return new;
end;
$$;
create trigger leagues_before_insert before insert on public.leagues
  for each row execute function private.leagues_before_insert();
create function private.leagues_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.league_admins (league_id, user_id) values (new.id, new.created_by) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger leagues_after_insert after insert on public.leagues
  for each row execute function private.leagues_after_insert();

alter table public.leagues enable row level security;
alter table public.league_admins enable row level security;
alter table public.league_teams enable row level security;
alter table public.league_members enable row level security;
revoke all on public.leagues, public.league_admins, public.league_teams, public.league_members from anon, authenticated;
grant select on public.leagues, public.league_admins, public.league_teams to authenticated;
grant insert (name, kind, description, starts_on, ends_on, scoring, team_size_max) on public.leagues to authenticated;
grant update (name, description, starts_on, ends_on, scoring, team_size_max, status) on public.leagues to authenticated;
grant insert (league_id, user_id), delete on public.league_admins to authenticated;
grant insert (league_id, name, affiliation, club_id, join_code), update (name, join_code), delete on public.league_teams to authenticated;
grant select (league_id, team_id, user_id, joined_at), delete on public.league_members to authenticated;

create policy "leagues: published or admin" on public.leagues for select to authenticated
  using (status <> 'draft' or (select private.is_league_admin(id)));
create policy "leagues: managers create" on public.leagues for insert to authenticated
  with check ((select private.has_role('admin')) or (select private.has_role('programme_manager')));
create policy "leagues: admins edit" on public.leagues for update to authenticated
  using ((select private.is_league_admin(id))) with check ((select private.is_league_admin(id)));
create policy "league_admins: visible" on public.league_admins for select to authenticated using (true);
create policy "league_admins: admins appoint" on public.league_admins for insert to authenticated
  with check ((select private.is_league_admin(league_id)));
create policy "league_admins: admins remove" on public.league_admins for delete to authenticated
  using ((select private.is_league_admin(league_id)) and user_id <> (select auth.uid()));
-- Join codes are only visible to league admins (the column is masked through a view below).
create policy "league_teams: visible with the league" on public.league_teams for select to authenticated
  using (exists (select 1 from public.leagues l where l.id = league_id));
create policy "league_teams: admins manage" on public.league_teams for all to authenticated
  using ((select private.is_league_admin(league_id))) with check ((select private.is_league_admin(league_id)));
create policy "league_members: visible with the league" on public.league_members for select to authenticated
  using (exists (select 1 from public.leagues l where l.id = league_id));
create policy "league_members: leave or admin removes" on public.league_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_league_admin(league_id)));

-- Hide join codes from non-admins: revoke the column and expose it through a function.
revoke select on public.league_teams from authenticated;
grant select (id, league_id, name, affiliation, club_id, created_at) on public.league_teams to authenticated;

create function public.league_team_codes(p_league uuid)
returns table (team_id uuid, join_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.join_code from public.league_teams t
   where t.league_id = p_league and private.is_league_admin(p_league);
$$;

-- Joining: club teams need active club membership; other teams need the code.
create function public.join_league_team(p_team uuid, p_code text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.league_teams;
  l public.leagues;
  n integer;
begin
  select * into t from public.league_teams where id = p_team;
  select * into l from public.leagues where id = t.league_id;
  if t.id is null or l.status not in ('active', 'draft') or (l.status = 'draft' and not private.is_league_admin(l.id)) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if l.ends_on < (now() at time zone l.timezone)::date then
    raise exception 'this league has finished' using errcode = '22023';
  end if;
  if t.club_id is not null then
    if not private.is_club_member(t.club_id) then
      raise exception 'join the club first' using errcode = '42501';
    end if;
  elsif t.join_code is null or upper(btrim(coalesce(p_code, ''))) <> t.join_code then
    raise exception 'that code is not right' using errcode = '42501';
  end if;
  if l.kind = 'beginner' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.fitness_level = 'regular') then
    raise exception 'this league is for new and returning runners' using errcode = '22023';
  end if;
  select count(*) into n from public.league_members where team_id = p_team;
  if n >= l.team_size_max then
    raise exception 'this team is full' using errcode = '22023';
  end if;
  perform private.enforce_rate_limit('league_join', 20, interval '1 day');
  insert into public.league_members (league_id, team_id, user_id) values (l.id, p_team, (select auth.uid()))
  on conflict (league_id, user_id) do nothing;
  if not found then
    raise exception 'you are already in a team in this league' using errcode = '23505';
  end if;
end;
$$;

-- Points per member for a league, from the league's own window and weights.
create function private.league_member_points(l public.leagues)
returns table (user_id uuid, team_id uuid, active_days bigint, consistent_weeks bigint, group_runs bigint,
               km numeric, challenges bigint, events bigint, points numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select (l.starts_on::timestamp at time zone l.timezone) as f,
           least(((l.ends_on + 1)::timestamp at time zone l.timezone), now()) as t
  ),
  days as (
    select m.user_id, (a.started_at at time zone l.timezone)::date as d, sum(a.distance_m) as m
      from public.league_members m
      join public.activities a on a.user_id = m.user_id and a.status = 'ready'
      cross join win
     where m.league_id = l.id and a.started_at >= win.f and a.started_at < win.t
     group by 1, 2
  ),
  per as (
    select m.user_id, m.team_id,
      (select count(*) from days x where x.user_id = m.user_id) as active_days,
      (select count(*) from (select date_trunc('week', x.d) w from days x where x.user_id = m.user_id
                              group by 1 having count(*) >= 3) q) as consistent_weeks,
      (select count(*) from public.event_rsvps r join public.events e on e.id = r.event_id cross join win
        where r.user_id = m.user_id and r.checked_in_at is not null and e.starts_at >= win.f and e.starts_at < win.t) as group_runs,
      coalesce((select sum(least(x.m, 50000)) from days x where x.user_id = m.user_id), 0) / 1000.0 as km,
      (select count(*) from public.challenge_participants cp cross join win
        where cp.user_id = m.user_id and cp.completed_at >= win.f and cp.completed_at < win.t) as challenges,
      (select count(*) from public.event_results er join public.events e on e.id = er.event_id cross join win
        where er.user_id = m.user_id and er.outcome = 'finished' and e.starts_at >= win.f and e.starts_at < win.t) as events
    from public.league_members m where m.league_id = l.id
  )
  select p.user_id, p.team_id, p.active_days, p.consistent_weeks, p.group_runs, round(p.km, 1), p.challenges, p.events,
    round(p.active_days * coalesce((l.scoring->>'active_day')::numeric, 0)
        + p.consistent_weeks * coalesce((l.scoring->>'consistent_week')::numeric, 0)
        + p.group_runs * coalesce((l.scoring->>'group_run')::numeric, 0)
        + floor(p.km / 5) * coalesce((l.scoring->>'per_5km')::numeric, 0)
        + p.challenges * coalesce((l.scoring->>'challenge')::numeric, 0)
        + p.events * coalesce((l.scoring->>'event')::numeric, 0), 0)
  from per p;
$$;
revoke all on function private.league_member_points(public.leagues) from public, anon, authenticated;

create function public.league_standings(p_league uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.leagues;
begin
  select * into l from public.leagues where id = p_league;
  if l.id is null or (l.status = 'draft' and not private.is_league_admin(p_league)) then
    raise exception 'league not found' using errcode = 'P0002';
  end if;
  return (
    with pts as (select * from private.league_member_points(l))
    select jsonb_build_object(
      'teams', coalesce((
        select jsonb_agg(jsonb_build_object('teamId', t.id, 'name', t.name, 'affiliation', t.affiliation,
                 'members', (select count(*) from pts where pts.team_id = t.id),
                 'points', coalesce((select sum(points) from pts where pts.team_id = t.id), 0),
                 'perMember', case when (select count(*) from pts where pts.team_id = t.id) > 0
                   then round(coalesce((select sum(points) from pts where pts.team_id = t.id), 0)
                              / (select count(*) from pts where pts.team_id = t.id), 1) end,
                 'activeDays', coalesce((select sum(active_days) from pts where pts.team_id = t.id), 0),
                 'km', coalesce((select sum(km) from pts where pts.team_id = t.id), 0))
               order by coalesce((select sum(points) from pts where pts.team_id = t.id), 0) desc, t.name)
        from public.league_teams t where t.league_id = p_league), '[]'::jsonb),
      'individuals', coalesce((
        select jsonb_agg(x order by (x->>'points')::numeric desc) from (
          select jsonb_build_object(
            'name', case when coalesce(rs.show_on_leaderboard, true) or pts.user_id = (select auth.uid())
                         then p.display_name else null end,
            'me', pts.user_id = (select auth.uid()),
            'team', t.name, 'points', pts.points, 'activeDays', pts.active_days,
            'consistentWeeks', pts.consistent_weeks, 'groupRuns', pts.group_runs, 'km', pts.km,
            'challenges', pts.challenges, 'events', pts.events) x
          from pts join public.profiles p on p.id = pts.user_id join public.league_teams t on t.id = pts.team_id
          left join public.runner_settings rs on rs.user_id = pts.user_id
          order by pts.points desc limit 50) q), '[]'::jsonb),
      'computedAt', now()
    ));
end;
$$;

revoke all on function public.league_team_codes(uuid), public.join_league_team(uuid, text), public.league_standings(uuid) from public, anon;
grant execute on function public.league_team_codes(uuid), public.join_league_team(uuid, text), public.league_standings(uuid) to authenticated;
