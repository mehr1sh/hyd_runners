-- Challenges v2 (Release 2, workstream D).
--
-- * Challenges are rows (city-wide or club), not code. The existing weekly
--   challenges, XP, coins, badges and leaderboard are unchanged.
-- * Progress always comes from completed workout logs and event check-ins.
--   An imported activity links to exactly one workout log, so imports and
--   manual logs of the same run never count twice.
-- * Fairness and anti-gaming: activities shorter than 10 minutes don't count,
--   distance counts at most 50 km per day, at most two activities per day
--   count towards activity totals, and logs created more than 3 days after a
--   challenge ends never count (no backfilling).
-- * Completion pays the configured reward through xp_ledger with the key
--   challenge:<id>, so it is paid exactly once whoever settles it.
-- * Programme managers and admins create city-wide challenges; club admins
--   create challenges for their own club only. Changes are audited.

alter table public.xp_ledger drop constraint xp_ledger_reason_check;
alter table public.xp_ledger add constraint xp_ledger_reason_check check (reason in (
  'workout_completed', 'planned_workout_on_time', 'streak_milestone', 'badge_earned',
  'event_attended', 'feedback_submitted', 'admin_adjustment', 'challenge_completed'
));

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  scope text not null check (scope in ('city', 'club')),
  club_id uuid references public.clubs (id) on delete cascade,
  -- distance: metres; active_days: days with >= 10 min; activities: count
  -- (max 2 per day); early_runs: days with a run starting 05:00–07:30 local;
  -- group_runs / events: check-ins; places: distinct places run or checked in;
  -- longest_run: a single activity of at least the goal in metres.
  kind text not null check (kind in ('distance', 'active_days', 'activities', 'early_runs', 'group_runs', 'events', 'places', 'longest_run')),
  goal numeric not null check (goal > 0),
  collective boolean not null default false,
  workout_types text[] not null default array['run', 'walk_run', 'walk']
    check (workout_types <@ array['run', 'walk_run', 'walk', 'strength', 'conditioning', 'mobility', 'cross_training']),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata',
  reward_xp integer not null default 50 check (reward_xp between 0 and 500),
  reward_coins integer not null default 0 check (reward_coins between 0 and 100),
  status text not null default 'active' check (status in ('draft', 'active', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint challenges_window check (ends_at > starts_at and ends_at <= starts_at + interval '366 days'),
  constraint challenges_scope_club check ((scope = 'club') = (club_id is not null)),
  constraint challenges_collective_kind check (not collective or kind in ('distance', 'active_days', 'activities', 'group_runs', 'events'))
);

create index challenges_active_idx on public.challenges (status, ends_at);
create index challenges_club_idx on public.challenges (club_id) where club_id is not null;

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

create index challenge_participants_user_idx on public.challenge_participants (user_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create function private.can_manage_challenge(p_scope text, p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or (p_scope = 'club' and p_club is not null and private.club_role(p_club) = 'admin'),
    false);
$$;

create function private.can_see_challenge(p_scope text, p_club uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.can_manage_challenge(p_scope, p_club)
      or (p_status = 'active' and (p_scope = 'city' or private.is_club_member(p_club))),
    false);
$$;

revoke all on function private.can_manage_challenge(text, uuid) from public;
revoke all on function private.can_see_challenge(text, uuid, text) from public;
grant execute on function private.can_manage_challenge(text, uuid) to authenticated;
grant execute on function private.can_see_challenge(text, uuid, text) to authenticated;

revoke all on public.challenges, public.challenge_participants from anon, authenticated;
grant select, delete on public.challenges to authenticated;
grant insert (title, description, scope, club_id, kind, goal, collective, workout_types, starts_at, ends_at, timezone,
              reward_xp, reward_coins, status, created_by) on public.challenges to authenticated;
grant update (title, description, status) on public.challenges to authenticated;
grant select, delete on public.challenge_participants to authenticated;
grant insert (challenge_id, user_id) on public.challenge_participants to authenticated;
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;

create policy "challenges: visible" on public.challenges for select to authenticated
  using ((select private.can_see_challenge(scope, club_id, status)));
create policy "challenges: organisers create" on public.challenges for insert to authenticated
  with check ((select private.can_manage_challenge(scope, club_id)) and created_by = (select auth.uid()));
create policy "challenges: organisers update" on public.challenges for update to authenticated
  using ((select private.can_manage_challenge(scope, club_id)))
  with check ((select private.can_manage_challenge(scope, club_id)));
create policy "challenges: organisers delete unjoined" on public.challenges for delete to authenticated
  using ((select private.can_manage_challenge(scope, club_id))
         and not exists (select 1 from public.challenge_participants p where p.challenge_id = id));

create policy "challenge_participants: own rows" on public.challenge_participants for select to authenticated
  using (user_id = (select auth.uid()));
-- Join only active, unfinished challenges you can see.
create policy "challenge_participants: join" on public.challenge_participants for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.challenges c where c.id = challenge_id and c.status = 'active' and c.ends_at > now()
                and private.can_see_challenge(c.scope, c.club_id, c.status))
  );
-- Leave only before completing.
create policy "challenge_participants: leave" on public.challenge_participants for delete to authenticated
  using (user_id = (select auth.uid()) and completed_at is null);

create function private.audit_challenges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('challenge.created', 'challenge', new.id::text, null,
      jsonb_build_object('scope', new.scope, 'club_id', new.club_id, 'kind', new.kind, 'reward_xp', new.reward_xp));
  elsif new.status is distinct from old.status then
    perform private.write_audit('challenge.status_changed', 'challenge', new.id::text, null,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger challenges_audit after insert or update on public.challenges
  for each row execute function private.audit_challenges();

-- ---------------------------------------------------------------------------
-- Progress (one rule set, used by every reader and by settlement)
-- ---------------------------------------------------------------------------

create function private.challenge_progress(c public.challenges, p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with logs as (
    select w.started_at, (w.started_at at time zone c.timezone) as local_ts, w.duration_seconds,
           coalesce(w.distance_meters, 0) as dist, w.location_id
    from public.workout_logs w
    where w.user_id = p_user and w.status = 'completed'
      and w.workout_type = any (c.workout_types)
      and w.duration_seconds >= 600
      and w.started_at >= c.starts_at and w.started_at < c.ends_at
      and w.created_at <= c.ends_at + interval '3 days'
  ),
  checkins as (
    select e.id, e.series_id, e.location_id
    from public.event_rsvps r join public.events e on e.id = r.event_id
    where r.user_id = p_user and r.checked_in_at is not null
      and e.starts_at >= c.starts_at and e.starts_at < c.ends_at
  )
  select case c.kind
    when 'distance' then (select coalesce(sum(least(d, 50000)), 0)
                          from (select sum(dist) as d from logs group by local_ts::date) per_day)
    when 'active_days' then (select count(distinct local_ts::date) from logs)
    when 'activities' then (select coalesce(sum(least(n, 2)), 0) from (select count(*) as n from logs group by local_ts::date) per_day)
    when 'early_runs' then (select count(distinct local_ts::date) from logs where local_ts::time between '05:00' and '07:30')
    when 'group_runs' then (select count(*) from checkins where series_id is not null)
    when 'events' then (select count(*) from checkins)
    when 'places' then (select count(distinct loc) from (select location_id as loc from logs union select location_id from checkins) p
                        where loc is not null)
    when 'longest_run' then (select coalesce(max(dist), 0) from logs)
  end;
$$;

revoke all on function private.challenge_progress(public.challenges, uuid) from public, anon, authenticated;

-- The caller's progress (and the group total for collective challenges).
create function public.my_challenge_progress(p_challenge_ids uuid[])
returns table (challenge_id uuid, joined boolean, progress numeric, collective_progress numeric, participants bigint,
               completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         p.user_id is not null,
         case when p.user_id is not null then private.challenge_progress(c, (select auth.uid())) end,
         case when c.collective then (select coalesce(sum(private.challenge_progress(c, q.user_id)), 0)
                                      from public.challenge_participants q where q.challenge_id = c.id) end,
         (select count(*) from public.challenge_participants q where q.challenge_id = c.id),
         p.completed_at
  from public.challenges c
  left join public.challenge_participants p on p.challenge_id = c.id and p.user_id = (select auth.uid())
  where c.id = any (p_challenge_ids) and private.can_see_challenge(c.scope, c.club_id, c.status);
$$;

-- Participants ranked by progress; runners hidden from leaderboards appear
-- only to themselves. Ties share a rank.
create function public.challenge_leaderboard(p_challenge_id uuid, p_limit integer default 20)
returns table (rank bigint, display_name text, progress numeric, completed boolean, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from public.challenges where id = p_challenge_id and private.can_see_challenge(scope, club_id, status)
  ),
  scored as (
    select q.user_id, private.challenge_progress(c, q.user_id) as progress, q.completed_at
    from c join public.challenge_participants q on q.challenge_id = c.id
  ),
  visible as (
    select s.*, pr.display_name from scored s
    join public.profiles pr on pr.id = s.user_id
    left join public.runner_settings rs on rs.user_id = s.user_id
    where coalesce(rs.show_on_leaderboard, true) or s.user_id = (select auth.uid())
  ),
  ranked as (
    select rank() over (order by v.progress desc) as rnk, v.* from visible v
  )
  select rnk, display_name, progress, completed_at is not null, user_id = (select auth.uid())
  from ranked
  where rnk <= greatest(1, least(p_limit, 100)) or user_id = (select auth.uid())
  order by rnk, display_name;
$$;

-- Complete and reward every finished challenge a runner has joined. Safe to
-- run any number of times, concurrently: completion is a conditional update
-- and the reward key is unique.
create function private.settle_challenges(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  mine numeric;
  total numeric;
  done integer := 0;
begin
  for c in
    select ch.* from public.challenges ch
    join public.challenge_participants p on p.challenge_id = ch.id and p.user_id = p_user and p.completed_at is null
    where ch.status = 'active' and ch.starts_at <= now() and ch.ends_at + interval '3 days' > now()
  loop
    mine := private.challenge_progress(c, p_user);
    if c.collective then
      continue when mine <= 0;
      select coalesce(sum(private.challenge_progress(c, q.user_id)), 0) into total
        from public.challenge_participants q where q.challenge_id = c.id;
    else
      total := mine;
    end if;
    continue when total < c.goal;
    update public.challenge_participants set completed_at = now()
     where challenge_id = c.id and user_id = p_user and completed_at is null;
    if found then
      insert into public.xp_ledger (user_id, delta_xp, delta_coins, reason, ref_table, ref_id, award_key, occurred_at)
      values (p_user, c.reward_xp, c.reward_coins, 'challenge_completed', 'challenges', c.id, 'challenge:' || c.id, now())
      on conflict (user_id, award_key) do nothing;
      done := done + 1;
    end if;
  end loop;
  return done;
end;
$$;

create function public.settle_my_challenges()
returns integer
language sql
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then 0 else private.settle_challenges((select auth.uid())) end;
$$;

create function public.settle_challenges_for(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.settle_challenges(p_user);
$$;

revoke all on function private.settle_challenges(uuid) from public, anon, authenticated;
revoke all on function public.my_challenge_progress(uuid[]) from public, anon;
revoke all on function public.challenge_leaderboard(uuid, integer) from public, anon;
revoke all on function public.settle_my_challenges() from public, anon;
revoke all on function public.settle_challenges_for(uuid) from public, anon, authenticated;
grant execute on function public.my_challenge_progress(uuid[]) to authenticated;
grant execute on function public.challenge_leaderboard(uuid, integer) to authenticated;
grant execute on function public.settle_my_challenges() to authenticated;
grant execute on function public.settle_challenges_for(uuid) to service_role;
