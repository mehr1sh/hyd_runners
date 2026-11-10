-- pgTAP: leagues (migration 20261126120000_leagues): organiser-only creation
-- and administration with audit, hidden drafts and join codes, joining rules
-- (code or club membership, one team per league, beginner leagues), and
-- transparent, duplicate-resistant scoring that respects leaderboard opt-outs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.run(owner uuid, at timestamptz, metres numeric) returns void language sql as $$
  insert into public.activities (user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds,
                                 moving_seconds, moving_source, distance_m, avg_pace_s, has_gps)
  values (owner, 'run', 'ready', 'gpx', at, at + interval '30 minutes', 1800, 1800, 'derived', metres, 360, false);
$$;

-- M manages; A and B run; C is a stranger.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c1000000-0000-4000-8000-0000000000f1', 'lg.m@example.test', '{"display_name":"League Manager"}', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-0000000000a1', 'lg.a@example.test', '{"display_name":"League A"}', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-0000000000b1', 'lg.b@example.test', '{"display_name":"League B"}', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-0000000000c1', 'lg.c@example.test', '{"display_name":"League C"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('c1000000-0000-4000-8000-0000000000f1', 'programme_manager');
insert into public.runner_settings (user_id, show_on_leaderboard) values ('c1000000-0000-4000-8000-0000000000b1', false);
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.act_as('c1000000-0000-4000-8000-0000000000a1');
select throws_ok($$ insert into public.leagues (name, kind, starts_on, ends_on) values ('Mine', 'city', current_date, current_date + 30) $$,
  '42501', null, 'runners cannot create leagues');

select pg_temp.act_as('c1000000-0000-4000-8000-0000000000f1');
select lives_ok($$ with x as (insert into public.leagues (name, kind, starts_on, ends_on) values
  ('Tech Park League', 'corporate', current_date - 14, current_date + 30) returning id) insert into ids select 'l', id from x $$,
  'a manager creates a league');
select is((select status from public.leagues where id = (select v from ids where k = 'l')), 'draft', 'leagues start as drafts');
select throws_ok($$ update public.leagues set scoring = '{"active_day": 500}' where id = (select v from ids where k = 'l') $$,
  '22023', null, 'scoring weights are bounded');
select throws_ok($$ update public.leagues set scoring = '{"fastest_5k": 10}' where id = (select v from ids where k = 'l') $$,
  '23514', null, 'speed cannot be a scoring metric');
select lives_ok($$ with x as (insert into public.league_teams (league_id, name, affiliation, join_code) values
  ((select v from ids where k = 'l'), 'Cyber Towers', 'corporate', 'CYBER2026') returning id) insert into ids select 't', id from x $$,
  'the admin adds a team with a join code');

select pg_temp.act_as('c1000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.leagues where id = (select v from ids where k = 'l')), 0::bigint, 'drafts are hidden');
reset role;
update public.leagues set status = 'active' where id = (select v from ids where k = 'l');
select pg_temp.act_as('c1000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select join_code from public.league_teams $$, '42501', null, 'join codes are not readable');
select is((select count(*) from public.league_team_codes((select v from ids where k = 'l'))), 0::bigint,
  'and not listed to non-admins');
select throws_ok($$ select public.join_league_team((select v from ids where k = 't'), 'WRONG1') $$, '42501', null,
  'a wrong code is refused');
select lives_ok($$ select public.join_league_team((select v from ids where k = 't'), 'cyber2026') $$, 'A joins with the code');
select throws_ok($$ select public.join_league_team((select v from ids where k = 't'), 'CYBER2026') $$, '23505', null,
  'one team per league');
select throws_ok($$ insert into public.league_members (league_id, team_id, user_id) values
  ((select v from ids where k = 'l'), (select v from ids where k = 't'), 'c1000000-0000-4000-8000-0000000000a1') $$, '42501', null,
  'membership is only created through joining');
select pg_temp.act_as('c1000000-0000-4000-8000-0000000000b1');
select lives_ok($$ select public.join_league_team((select v from ids where k = 't'), 'CYBER2026') $$, 'B joins');

-- Scoring: A runs on three days this week (twice on one day) and once 80 km.
reset role;
select pg_temp.run('c1000000-0000-4000-8000-0000000000a1', ((current_date - 1) + time '06:00') at time zone 'Asia/Kolkata', 6000);
select pg_temp.run('c1000000-0000-4000-8000-0000000000a1', ((current_date - 1) + time '18:00') at time zone 'Asia/Kolkata', 4000);
select pg_temp.run('c1000000-0000-4000-8000-0000000000a1', ((current_date - 2) + time '06:00') at time zone 'Asia/Kolkata', 80000);
select pg_temp.run('c1000000-0000-4000-8000-0000000000a1', ((current_date - 3) + time '06:00') at time zone 'Asia/Kolkata', 5000);
select pg_temp.run('c1000000-0000-4000-8000-0000000000b1', ((current_date - 1) + time '07:00') at time zone 'Asia/Kolkata', 5000);
select pg_temp.run('c1000000-0000-4000-8000-0000000000a1', ((current_date - 30) + time '06:00') at time zone 'Asia/Kolkata', 10000);

select pg_temp.act_as('c1000000-0000-4000-8000-0000000000c1');
create temp table st as select public.league_standings((select v from ids where k = 'l')) s;
select is((select (x->>'activeDays')::int from st, jsonb_array_elements(s->'individuals') x where x->>'name' = 'League A'), 3,
  'two runs on one day count as one active day; runs before the league don''t count');
select is((select (x->>'km')::numeric from st, jsonb_array_elements(s->'individuals') x where x->>'name' = 'League A'), 65.0,
  'distance is capped at 50 km a day');
select ok((select (x->>'consistentWeeks')::int >= 0 from st, jsonb_array_elements(s->'individuals') x where x->>'name' = 'League A'),
  'consistent weeks are reported');
select is((select (x->>'points')::numeric from st, jsonb_array_elements(s->'individuals') x where x->>'name' = 'League A'),
  (select 3 * 10 + (x->>'consistentWeeks')::numeric * 25 + floor(65.0 / 5) * 5 from st, jsonb_array_elements(s->'individuals') x
    where x->>'name' = 'League A'), 'points follow the published weights');
select is((select count(*)::int from st, jsonb_array_elements(s->'individuals') x where x->>'name' is null), 1,
  'a runner hidden from leaderboards is not named');
select is((select (t->>'members')::int from st, jsonb_array_elements(s->'teams') t), 2, 'but still counts for the team');
select is((select (t->>'km')::numeric from st, jsonb_array_elements(s->'teams') t), 70.0, 'team distance includes everyone');
reset role;
select ok((select count(*) from public.audit_log where target_type = 'leagues' and target_id = (select v::text from ids where k = 'l')) >= 2,
  'league changes are audited');

select * from finish();
rollback;
