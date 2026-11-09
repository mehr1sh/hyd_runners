-- pgTAP: training v2 (migration 20261120120000_training_v2): race goals are
-- owner-only with one active goal; proposals change nothing until the runner
-- accepts them; acceptance is atomic and may leave out changes; nobody else can
-- decide or read them; shortening never lengthens a session.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('7b000000-0000-4000-8000-0000000000a1', 'tr.a@example.test', '{"display_name":"Train A"}', 'authenticated', 'authenticated'),
  ('7b000000-0000-4000-8000-0000000000b1', 'tr.b@example.test', '{"display_name":"Train B"}', 'authenticated', 'authenticated');

-- A has two planned sessions next week.
insert into public.scheduled_workouts (id, user_id, title, workout_type, starts_at, duration_minutes, planned_by) values
  ('7b000000-0000-4000-8000-00000000e001', '7b000000-0000-4000-8000-0000000000a1', 'Easy run', 'run', now() + interval '2 days', 40, 'runner'),
  ('7b000000-0000-4000-8000-00000000e002', '7b000000-0000-4000-8000-0000000000a1', 'Long run', 'run', now() + interval '4 days', 90, 'runner');

select pg_temp.act_as('7b000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.race_goals (id, user_id, distance, race_date, current_level, days_per_week)
  values ('7b000000-0000-4000-8000-00000000a0a1', '7b000000-0000-4000-8000-0000000000a1', 'half', current_date + 90, 'returning', 4) $$,
  'a runner sets a race goal');
select throws_ok($$ insert into public.race_goals (user_id, distance, race_date, current_level, days_per_week)
  values ('7b000000-0000-4000-8000-0000000000a1', '10k', current_date + 30, 'returning', 3) $$,
  '23505', null, 'only one active goal at a time');
select throws_ok($$ insert into public.race_goals (user_id, distance, race_date, current_level, days_per_week)
  values ('7b000000-0000-4000-8000-0000000000a1', '10k', current_date - 1, 'returning', 3) $$,
  '22023', null, 'race dates in the past are rejected');
select throws_ok($$ insert into public.race_goals (user_id, distance, race_date, current_level, days_per_week)
  values ('7b000000-0000-4000-8000-0000000000b1', '10k', current_date + 30, 'returning', 3) $$,
  '42501', null, 'nobody sets a goal for someone else');

-- A proposal: add one session, shorten the long run, cancel the easy run.
select lives_ok($$ insert into public.training_proposals (id, user_id, kind, title, summary, changes, race_goal_id) values
  ('7b000000-0000-4000-8000-00000000f001', '7b000000-0000-4000-8000-0000000000a1', 'adaptive', 'Ease off', 'Lighter week',
   jsonb_build_array(
     jsonb_build_object('op', 'add', 'title', 'Tempo run', 'workout_type', 'run', 'starts_at', now() + interval '3 days',
                        'duration_minutes', 45, 'rationale', jsonb_build_array('test'), 'details', jsonb_build_object('kind', 'tempo')),
     jsonb_build_object('op', 'shorten', 'workout_id', '7b000000-0000-4000-8000-00000000e002', 'duration_minutes', 70),
     jsonb_build_object('op', 'cancel', 'workout_id', '7b000000-0000-4000-8000-00000000e001')),
   '7b000000-0000-4000-8000-00000000a0a1') $$, 'a runner files a proposal for themselves');
select is((select count(*) from public.scheduled_workouts where user_id = '7b000000-0000-4000-8000-0000000000a1'), 2::bigint,
  'a proposal changes nothing on its own');
select throws_ok($$ update public.training_proposals set status = 'accepted' $$, '42501', null,
  'status cannot be set directly');
select throws_ok($$ insert into public.training_proposals (user_id, kind, title, summary, changes) values
  ('7b000000-0000-4000-8000-0000000000a1', 'coach', 'x', 'y', '[{"op":"cancel"}]') $$, '42501', null,
  'runners cannot file coach proposals');
select throws_ok($$ insert into public.training_proposals (user_id, kind, title, summary, changes) values
  ('7b000000-0000-4000-8000-0000000000b1', 'adaptive', 'x', 'y', '[{"op":"cancel"}]') $$, '42501', null,
  'nobody files proposals for someone else');

select pg_temp.act_as('7b000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.training_proposals), 0::bigint, 'another runner cannot see proposals');
select is((select count(*) from public.race_goals), 0::bigint, 'or race goals');
select throws_ok($$ select public.decide_training_proposal('7b000000-0000-4000-8000-00000000f001', true) $$,
  'P0002', null, 'or decide them');

-- A accepts everything except the cancel (change 3).
select pg_temp.act_as('7b000000-0000-4000-8000-0000000000a1');
select is(public.decide_training_proposal('7b000000-0000-4000-8000-00000000f001', true, array[3]), 2,
  'accepting applies the selected changes');
select is((select status::text from public.scheduled_workouts where id = '7b000000-0000-4000-8000-00000000e001'), 'planned',
  'the left-out change was not applied');
select is((select duration_minutes from public.scheduled_workouts where id = '7b000000-0000-4000-8000-00000000e002'), 70,
  'the long run was shortened');
select is((select race_goal_id from public.scheduled_workouts where title = 'Tempo run'), '7b000000-0000-4000-8000-00000000a0a1'::uuid,
  'added sessions carry the race goal');
select is((select planned_by from public.scheduled_workouts where title = 'Tempo run'), 'scheduler',
  'and are marked as planned by the scheduler');
select is((select status || ':' || array_to_string(applied_changes, ',') from public.training_proposals
            where id = '7b000000-0000-4000-8000-00000000f001'), 'accepted:1,2', 'the decision and applied changes are recorded');
select throws_ok($$ select public.decide_training_proposal('7b000000-0000-4000-8000-00000000f001', false) $$,
  '23505', null, 'a decided proposal cannot be decided again');

-- Atomicity: a stale change aborts the whole acceptance.
insert into public.training_proposals (id, user_id, kind, title, summary, changes) values
  ('7b000000-0000-4000-8000-00000000f002', '7b000000-0000-4000-8000-0000000000a1', 'missed_session', 'Missed', 'Stale',
   jsonb_build_array(
     jsonb_build_object('op', 'add', 'title', 'Should roll back', 'workout_type', 'run', 'starts_at', now() + interval '5 days',
                        'duration_minutes', 30),
     jsonb_build_object('op', 'mark_missed', 'workout_id', gen_random_uuid())));
select throws_ok($$ select public.decide_training_proposal('7b000000-0000-4000-8000-00000000f002', true) $$,
  'P0002', null, 'a change that no longer applies fails the acceptance');
select is((select count(*) from public.scheduled_workouts where title = 'Should roll back'), 0::bigint,
  'and nothing from it is kept');

-- Shortening never lengthens.
insert into public.training_proposals (id, user_id, kind, title, summary, changes) values
  ('7b000000-0000-4000-8000-00000000f003', '7b000000-0000-4000-8000-0000000000a1', 'adaptive', 'Longer?', 'No',
   jsonb_build_array(jsonb_build_object('op', 'shorten', 'workout_id', '7b000000-0000-4000-8000-00000000e002', 'duration_minutes', 120)));
select throws_ok($$ select public.decide_training_proposal('7b000000-0000-4000-8000-00000000f003', true) $$,
  'P0002', null, 'a "shorten" cannot make a session longer');
select throws_ok($$ update public.scheduled_workouts set duration_minutes = 200 $$, '42501', null,
  'runners cannot change durations directly');

-- Reject leaves the schedule alone.
select lives_ok($$ select public.decide_training_proposal('7b000000-0000-4000-8000-00000000f003', false) $$, 'a runner rejects');

select * from finish();
rollback;
