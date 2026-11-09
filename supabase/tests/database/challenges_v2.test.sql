-- pgTAP: Challenges v2 (migration 20261116120000_challenges_v2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.log(owner uuid, start timestamptz, mins int, dist int, typ text default 'run',
                            created timestamptz default null) returns void language sql as $$
  insert into public.workout_logs (user_id, status, title, workout_type, started_at, completed_at, duration_seconds,
                                   distance_meters, source, idempotency_key, created_at)
  values (owner, 'completed', 'Run', typ, start, start + make_interval(mins => mins), mins * 60, dist, 'manual',
          gen_random_uuid(), coalesce(created, start + interval '1 hour'));
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('ad000000-0000-4000-8000-0000000000d1', 'ch.m@example.test', '{"display_name":"Ch Manager"}', 'authenticated', 'authenticated'),
  ('ad000000-0000-4000-8000-0000000000c1', 'ch.c@example.test', '{"display_name":"Ch Club Admin"}', 'authenticated', 'authenticated'),
  ('ad000000-0000-4000-8000-0000000000a1', 'ch.a@example.test', '{"display_name":"Ch Runner A"}', 'authenticated', 'authenticated'),
  ('ad000000-0000-4000-8000-0000000000a2', 'ch.b@example.test', '{"display_name":"Ch Runner B"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('ad000000-0000-4000-8000-0000000000d1', 'programme_manager');
insert into public.clubs (id, slug, name, join_policy) values ('ad000000-0000-4000-8000-0000000000b1', 'ch-club', 'Ch Club', 'open');
insert into public.club_members (club_id, user_id, role, status, joined_at) values
  ('ad000000-0000-4000-8000-0000000000b1', 'ad000000-0000-4000-8000-0000000000c1', 'admin', 'active', now()),
  ('ad000000-0000-4000-8000-0000000000b1', 'ad000000-0000-4000-8000-0000000000a1', 'member', 'active', now());

-- ---------------------------------------------------------------- creation
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ insert into public.challenges (title, scope, kind, goal, starts_at, ends_at, created_by)
     values ('Rogue', 'city', 'distance', 1000, now(), now() + interval '7 days', 'ad000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'runners cannot create challenges');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000c1');
select throws_ok(
  $$ insert into public.challenges (title, scope, kind, goal, starts_at, ends_at, created_by)
     values ('City by club admin', 'city', 'distance', 1000, now(), now() + interval '7 days', 'ad000000-0000-4000-8000-0000000000c1') $$,
  '42501', null, 'club admins cannot create city-wide challenges');
select lives_ok(
  $$ insert into public.challenges (title, scope, club_id, kind, goal, collective, starts_at, ends_at, created_by)
     values ('Club 100 km', 'club', 'ad000000-0000-4000-8000-0000000000b1', 'distance', 100000, true,
             now() - interval '10 days', now() + interval '5 days', 'ad000000-0000-4000-8000-0000000000c1') $$,
  'club admins create challenges for their club');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ insert into public.challenges (title, scope, kind, goal, starts_at, ends_at, reward_xp, reward_coins, created_by) values
       ('Five active days', 'city', 'active_days', 5, now() - interval '10 days', now() + interval '5 days', 80, 10, 'ad000000-0000-4000-8000-0000000000d1'),
       ('20 km month', 'city', 'distance', 20000, now() - interval '10 days', now() + interval '5 days', 60, 0, 'ad000000-0000-4000-8000-0000000000d1'),
       ('Early riser', 'city', 'early_runs', 2, now() - interval '10 days', now() + interval '5 days', 40, 0, 'ad000000-0000-4000-8000-0000000000d1'),
       ('Ended', 'city', 'activities', 1, now() - interval '30 days', now() - interval '20 days', 40, 0, 'ad000000-0000-4000-8000-0000000000d1') $$,
  'managers create city-wide challenges');
select throws_ok(
  $$ insert into public.challenges (title, scope, kind, goal, collective, starts_at, ends_at, created_by)
     values ('Bad', 'city', 'longest_run', 10000, true, now(), now() + interval '7 days', 'ad000000-0000-4000-8000-0000000000d1') $$,
  '23514', null, 'a longest-run challenge cannot be collective');
reset role;
create temp table ids as select title, id from public.challenges where created_by::text like 'ad000000-%';
grant select on ids to authenticated;

-- ---------------------------------------------------------------- joining and visibility
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.challenges where title = 'Club 100 km'), 0, 'non-members cannot see club challenges');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id) select id, 'ad000000-0000-4000-8000-0000000000a2' from ids where title = 'Club 100 km' $$,
  '42501', null, 'non-members cannot join club challenges');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id) select id, 'ad000000-0000-4000-8000-0000000000a2' from ids where title = 'Ended' $$,
  '42501', null, 'ended challenges cannot be joined');
select lives_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id) select id, 'ad000000-0000-4000-8000-0000000000a2' from ids where title in ('Five active days', '20 km month') $$,
  'runner B joins two city challenges');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id)
     select id, 'ad000000-0000-4000-8000-0000000000a1' from ids where title in ('Five active days', '20 km month', 'Early riser', 'Club 100 km') $$,
  'runner A joins four challenges, including their club''s');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id) select id, 'ad000000-0000-4000-8000-0000000000a2' from ids where title = 'Early riser' $$,
  '42501', null, 'nobody enrols someone else');

-- ---------------------------------------------------------------- progress rules
reset role;
-- Runner A: 4 days with runs (one day with three runs), one 7 km run at 06:15 local,
-- one 3-minute jog that never counts, and one log created long after a window would close.
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', now() - interval '6 days', 40, 7000);
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', now() - interval '5 days', 30, 5000);
-- Three logs on one local day (fixed hours, so they never straddle midnight in Asia/Kolkata).
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', (((now() at time zone 'Asia/Kolkata')::date - 4) + time '08:00') at time zone 'Asia/Kolkata', 30, 5000);
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', (((now() at time zone 'Asia/Kolkata')::date - 4) + time '10:00') at time zone 'Asia/Kolkata', 30, 5000);
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', (((now() at time zone 'Asia/Kolkata')::date - 4) + time '12:00') at time zone 'Asia/Kolkata', 30, 5000);
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', now() - interval '3 days', 3, 600);
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1',
                   ((current_date - 2) + time '06:15') at time zone 'Asia/Kolkata', 45, 8000);
-- Runner B: one 60 km day (capped at 50 km).
select pg_temp.log('ad000000-0000-4000-8000-0000000000a2', now() - interval '2 days', 300, 60000);

select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select is((select progress::int from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = 'Five active days'),
  4, 'active days count distinct days with at least 10 minutes');
select is((select progress::int from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = '20 km month'),
  35000, 'distance counts every qualifying log once');
select is((select progress::int from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = 'Early riser'),
  1, 'early runs count days with a run starting 05:00–07:30 local');
select is((select collective_progress::int from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = 'Club 100 km'),
  35000, 'collective challenges total all participants');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a2');
select is((select progress::int from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = '20 km month'),
  50000, 'distance is capped at 50 km per day');
select is((select joined from public.my_challenge_progress((select array_agg(id) from ids)) p join ids on ids.id = p.challenge_id where title = 'Early riser'),
  false, 'progress is reported only for challenges the runner joined');

-- ---------------------------------------------------------------- settlement and rewards
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select is(public.settle_my_challenges(), 1, 'settling completes the 20 km challenge');
select is(public.settle_my_challenges(), 0, 'settling again changes nothing');
reset role;
select is((select count(*)::int from public.xp_ledger where user_id = 'ad000000-0000-4000-8000-0000000000a1' and reason = 'challenge_completed'), 1,
  'the reward is paid once');
select is((select delta_xp from public.xp_ledger where user_id = 'ad000000-0000-4000-8000-0000000000a1' and reason = 'challenge_completed'), 60,
  'with the configured XP');
select pg_temp.log('ad000000-0000-4000-8000-0000000000a1', now() - interval '1 day', 30, 5000);
select set_config('role', 'service_role', true);
select is(public.settle_challenges_for('ad000000-0000-4000-8000-0000000000a1'), 1, 'the server settles after a new workout (fifth active day)');
reset role;
select is((select sum(delta_coins)::int from public.xp_ledger where user_id = 'ad000000-0000-4000-8000-0000000000a1' and reason = 'challenge_completed'), 10,
  'coins are paid too');

select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select public.settle_challenges_for('ad000000-0000-4000-8000-0000000000a2') $$, '42501', null,
  'runners cannot settle for someone else');
delete from public.challenge_participants where user_id = 'ad000000-0000-4000-8000-0000000000a1'
  and challenge_id = (select id from ids where title = '20 km month');
select is((select count(*)::int from public.challenge_participants where user_id = 'ad000000-0000-4000-8000-0000000000a1'
             and challenge_id = (select id from ids where title = '20 km month')), 1, 'completed challenges cannot be left');
select is((select string_agg(display_name || ':' || progress::int, ',' order by rank)
             from public.challenge_leaderboard((select id from ids where title = '20 km month'))),
  'Ch Runner B:50000,Ch Runner A:40000', 'the leaderboard ranks participants by progress');
reset role;
insert into public.runner_settings (user_id, show_on_leaderboard) values ('ad000000-0000-4000-8000-0000000000a2', false);
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.challenge_leaderboard((select id from ids where title = '20 km month'))), 1,
  'runners hidden from leaderboards are not listed');

-- ---------------------------------------------------------------- backfilling and audit
reset role;
select pg_temp.log('ad000000-0000-4000-8000-0000000000a2', now() - interval '25 days', 30, 5000, 'run', now());
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000d1');
reset role;
select is(
  (select private.challenge_progress(c, 'ad000000-0000-4000-8000-0000000000a2') from public.challenges c where title = 'Ended'),
  0::numeric, 'logs created more than 3 days after a challenge ended never count');
select is((select count(*)::int from public.audit_log where action = 'challenge.created' and target_id in (select id::text from ids)), 5,
  'challenge creation is audited');

select * from finish();
rollback;
