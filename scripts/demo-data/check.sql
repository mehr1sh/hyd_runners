-- HYD Runners local demo data: consistency checks, run by `pnpm demo:check`
-- (and in CI after seeding twice). Raises on the first problem; otherwise
-- prints one JSON line of row counts, which must not change on a re-seed.

\set ON_ERROR_STOP on

create temp table demo_people as
  select u.id, u.email, u.raw_app_meta_data ->> 'demo' as flag from auth.users u
  where u.email like '%@demo.hydrunners.test';

do $$
declare
  n int;
begin
  -- Accounts: all 22, all flagged, all labelled.
  if (select count(*) from demo_people) <> 22 then
    raise exception 'expected 22 demo accounts, found %', (select count(*) from demo_people);
  end if;
  if exists (select 1 from demo_people where flag is distinct from 'true') then
    raise exception 'a demo email exists without app_metadata.demo';
  end if;
  if exists (select 1 from public.profiles p join demo_people d using (id) where p.display_name not like '% (sample)') then
    raise exception 'a demo profile is not labelled (sample)';
  end if;

  -- Professionals: sample profiles are never verified, so never bookable or listed in the directory.
  if exists (select 1 from public.professional_profiles where user_id in (select id from demo_people)
             and verification_status = 'verified') then
    raise exception 'a sample professional is marked verified';
  end if;
  if exists (select 1 from public.bookings where runner_id in (select id from demo_people)
             or professional_id in (select id from demo_people)) then
    raise exception 'demo bookings exist; the seed must not create bookings';
  end if;

  -- Clubs: each has an active admin; squads are within their size limit.
  if exists (select 1 from public.clubs c where c.id::text like 'de000001-%' and not exists (
      select 1 from public.club_members m where m.club_id = c.id and m.role = 'admin' and m.status = 'active')) then
    raise exception 'a demo club has no active admin';
  end if;
  if exists (select 1 from public.squads s where s.id::text like 'de000004-%' and s.max_members <
      (select count(*) from public.squad_members m where m.squad_id = s.id and m.status = 'active')) then
    raise exception 'a demo squad is over its member limit';
  end if;

  -- Leagues and challenges are open.
  if exists (select 1 from public.leagues where id::text like 'de000006-%' and status <> 'active')
     or exists (select 1 from public.challenges where id::text like 'de000008-%' and status <> 'active') then
    raise exception 'a demo league or challenge is not active';
  end if;

  -- Activities: every demo activity imported, linked to a workout, and the workout matches it.
  if exists (select 1 from public.activities a where a.user_id in (select id from demo_people) and a.status <> 'ready') then
    raise exception 'a demo activity is not ready';
  end if;
  if exists (select 1 from public.activities a join public.workout_logs w on w.id = a.workout_log_id
             where a.user_id in (select id from demo_people)
               and (w.user_id <> a.user_id or abs(w.distance_meters - a.distance_m) > 1
                    or abs(extract(epoch from (w.started_at - a.started_at))) > 1)) then
    raise exception 'a demo activity disagrees with its workout';
  end if;
  if exists (select 1 from public.activities a where a.user_id in (select id from demo_people) and a.workout_log_id is null) then
    raise exception 'a demo activity has no workout';
  end if;
  -- Paces in the files are believable for the runner (3:00 to 12:00 per km).
  if exists (select 1 from public.activities a where a.user_id in (select id from demo_people)
             and a.avg_pace_s not between 180 and 720) then
    raise exception 'a demo activity has an implausible pace';
  end if;

  -- Time-trial results are the runners' own GPS times.
  if exists (select 1 from public.event_results r
             join public.activities a on a.user_id = r.user_id and a.name = 'KBR 10K time trial'
             where r.event_id = 'de000003-0000-4000-8000-000000000001' and r.finish_seconds <> a.elapsed_seconds) then
    raise exception 'a time-trial result does not match its activity';
  end if;
  select count(*) into n from public.event_results where event_id = 'de000003-0000-4000-8000-000000000001';
  if n < 6 then raise exception 'expected time-trial results, found %', n; end if;

  -- The race passport's completed race is backed by the runner's own activity on race day.
  if not exists (select 1 from public.race_entries e join public.activities a on a.id = e.result_activity_id
                 where e.id = 'de000009-0000-4000-8000-000000000002' and a.user_id = e.user_id
                   and (a.started_at at time zone 'Asia/Kolkata')::date = e.race_date
                   and a.elapsed_seconds = e.result_seconds) then
    raise exception 'the completed race entry is not backed by a matching activity';
  end if;

  -- Rewards were reconciled: the main runner has XP and badges.
  if (select coalesce(sum(delta_xp), 0) from public.xp_ledger where user_id = 'de000000-0000-4000-8000-000000000001') <= 0
     or not exists (select 1 from public.user_badges where user_id = 'de000000-0000-4000-8000-000000000001') then
    raise exception 'the main demo runner has no rewards';
  end if;

  -- Her race plan was accepted into scheduled sessions.
  if not exists (select 1 from public.scheduled_workouts where user_id = 'de000000-0000-4000-8000-000000000001'
                 and race_goal_id is not null and starts_at > now()) then
    raise exception 'the main demo runner has no upcoming plan sessions';
  end if;
end $$;

select json_build_object(
  'accounts', (select count(*) from demo_people),
  'clubs', (select count(*) from public.clubs where id::text like 'de000001-%'),
  'club_members', (select count(*) from public.club_members where user_id in (select id from demo_people)),
  'events', (select count(*) from public.events where id::text like 'de000003-%'
             or series_id::text like 'de000002-%'),
  'rsvps', (select count(*) from public.event_rsvps where user_id in (select id from demo_people)),
  'squads', (select count(*) from public.squads where id::text like 'de000004-%'),
  'leagues', (select count(*) from public.leagues where id::text like 'de000006-%'),
  'challenges', (select count(*) from public.challenges where id::text like 'de000008-%'),
  'activities', (select count(*) from public.activities where user_id in (select id from demo_people)),
  'workouts', (select count(*) from public.workout_logs where user_id in (select id from demo_people)),
  'xp_rows', (select count(*) from public.xp_ledger where user_id in (select id from demo_people)),
  'badges', (select count(*) from public.user_badges where user_id in (select id from demo_people)),
  'follows', (select count(*) from public.follows where follower_id in (select id from demo_people)),
  'reactions', (select count(*) from public.activity_reactions where user_id in (select id from demo_people)),
  'comments', (select count(*) from public.activity_comments where author_id in (select id from demo_people)),
  'professionals', (select count(*) from public.professional_profiles where user_id in (select id from demo_people)),
  'plan_sessions', (select count(*) from public.scheduled_workouts where user_id in (select id from demo_people))
);
