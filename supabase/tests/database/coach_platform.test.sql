-- pgTAP: coach platform (migration 20261123120000_coach_platform): coaches see
-- only currently assigned runners, respect the runner's training switch, file
-- notes and proposals that only the runner can accept, lose access when the
-- role or assignment is revoked; professional verification is admin-only and
-- audited.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- R runs; C coaches R; D is an unassigned coach; S is a stranger; A is an admin.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('9d000000-0000-4000-8000-0000000000a1', 'cp.r@example.test', '{"display_name":"CP Runner"}', 'authenticated', 'authenticated'),
  ('9d000000-0000-4000-8000-0000000000c1', 'cp.c@example.test', '{"display_name":"CP Coach"}', 'authenticated', 'authenticated'),
  ('9d000000-0000-4000-8000-0000000000d1', 'cp.d@example.test', '{"display_name":"CP Other"}', 'authenticated', 'authenticated'),
  ('9d000000-0000-4000-8000-0000000000e1', 'cp.s@example.test', '{"display_name":"CP Stranger"}', 'authenticated', 'authenticated'),
  ('9d000000-0000-4000-8000-0000000000f1', 'cp.a@example.test', '{"display_name":"CP Admin"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('9d000000-0000-4000-8000-0000000000c1', 'coach'), ('9d000000-0000-4000-8000-0000000000d1', 'coach'),
  ('9d000000-0000-4000-8000-0000000000f1', 'admin');
insert into public.coach_assignments (coach_id, runner_id) values
  ('9d000000-0000-4000-8000-0000000000c1', '9d000000-0000-4000-8000-0000000000a1');
insert into public.activities (id, user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds,
                               moving_seconds, moving_source, distance_m, avg_pace_s, has_gps, visibility,
                               public_path, best_efforts)
values ('9d000000-0000-4000-8000-00000000ac01', '9d000000-0000-4000-8000-0000000000a1', 'run', 'ready', 'gpx',
        now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', 1800, 1800, 'derived', 5000, 360,
        true, 'private', extensions.st_geogfromtext('SRID=4326;LINESTRING(78.42 17.42, 78.46 17.42)'), '{"5k": 1800}');
insert into public.scheduled_workouts (id, user_id, title, workout_type, starts_at, duration_minutes, planned_by) values
  ('9d000000-0000-4000-8000-00000000e001', '9d000000-0000-4000-8000-0000000000a1', 'Long run', 'run', now() + interval '3 days', 80, 'runner'),
  ('9d000000-0000-4000-8000-00000000e002', '9d000000-0000-4000-8000-0000000000e1', 'Stranger''s', 'run', now() + interval '3 days', 40, 'runner');

-- ---------------------------------------------------------------- coach views
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.coach_runner_list()), 1::bigint, 'the coach lists their runner');
select is((select distance_7d_m from public.coach_runner_list()), 5000::numeric, 'with recent distance');
select is((public.coach_runner_overview('9d000000-0000-4000-8000-0000000000a1')->'bestEfforts'->>'5k'), '1800',
  'the overview includes best efforts');
select ok(public.coach_runner_overview('9d000000-0000-4000-8000-0000000000a1')::text !~ 'LINESTRING|coordinates|public_path',
  'and never GPS');
select is((select count(*) from public.activities where user_id = '9d000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'coaches still cannot read private activities directly');
select throws_ok($$ select public.coach_runner_overview('9d000000-0000-4000-8000-0000000000e1') $$, '42501', null,
  'no overview of an unassigned runner');

select pg_temp.act_as('9d000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.coach_runner_list()), 0::bigint, 'an unassigned coach lists nobody');
select throws_ok($$ select public.coach_runner_overview('9d000000-0000-4000-8000-0000000000a1') $$, '42501', null,
  'and gets no overview');

-- The runner turns training sharing off.
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000a1');
select lives_ok($$ update public.profiles set coach_sees_training = false where id = '9d000000-0000-4000-8000-0000000000a1' $$,
  'a runner can stop sharing training with coaches');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select is((public.coach_runner_overview('9d000000-0000-4000-8000-0000000000a1')->>'sharesTraining'), 'false',
  'then the overview says so');
select ok((public.coach_runner_overview('9d000000-0000-4000-8000-0000000000a1') ? 'activities') is false, 'with no training data');
select is((select distance_7d_m from public.coach_runner_list()), null, 'and the list hides distance');
reset role;
update public.profiles set coach_sees_training = true where id = '9d000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------- notes
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select lives_ok($$ insert into public.coach_notes (id, runner_id, kind, body, activity_id) values
  ('9d000000-0000-4000-8000-0000000000b0', '9d000000-0000-4000-8000-0000000000a1', 'workout_feedback', 'Nice even pacing.',
   '9d000000-0000-4000-8000-00000000ac01') $$, 'the coach leaves feedback on an activity');
select throws_ok($$ insert into public.coach_notes (runner_id, kind, body) values
  ('9d000000-0000-4000-8000-0000000000e1', 'progress_note', 'Hi') $$, '42501', null, 'not on an unassigned runner');
select throws_ok($$ insert into public.coach_notes (runner_id, kind, body, scheduled_workout_id) values
  ('9d000000-0000-4000-8000-0000000000a1', 'progress_note', 'x', '9d000000-0000-4000-8000-00000000e002') $$, '42501', null,
  'notes cannot point at another runner''s session');
reset role;
select is((select count(*) from public.notifications where user_id = '9d000000-0000-4000-8000-0000000000a1' and kind = 'coach_note'),
  1::bigint, 'the runner is notified');
select is((select count(*) from public.audit_log where action = 'coach.note' and subject_id = '9d000000-0000-4000-8000-0000000000a1'),
  1::bigint, 'and the note is audited');

select pg_temp.act_as('9d000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.coach_note_replies (note_id, body) values ('9d000000-0000-4000-8000-0000000000b0', 'Thanks!') $$,
  'the runner replies');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.coach_notes) + (select count(*) from public.coach_note_replies), 0::bigint,
  'a stranger sees no notes or replies');
select throws_ok($$ insert into public.coach_note_replies (note_id, body) values ('9d000000-0000-4000-8000-0000000000b0', 'x') $$,
  '42501', null, 'and cannot reply');

-- ---------------------------------------------------------------- proposals
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select lives_ok($$ select public.coach_propose_changes('9d000000-0000-4000-8000-0000000000a1', 'Shorter long run', 'Ease off',
  array['Busy week'], jsonb_build_array(jsonb_build_object('op', 'shorten', 'workout_id', '9d000000-0000-4000-8000-00000000e001',
  'duration_minutes', 60))) $$, 'the coach proposes a change');
select throws_ok($$ select public.coach_propose_changes('9d000000-0000-4000-8000-0000000000a1', 'x', 'y', null,
  jsonb_build_array(jsonb_build_object('op', 'cancel', 'workout_id', '9d000000-0000-4000-8000-00000000e002'))) $$, '22023', null,
  'proposals may only touch the runner''s own sessions');
reset role;
select is((select duration_minutes from public.scheduled_workouts where id = '9d000000-0000-4000-8000-00000000e001'), 80,
  'nothing changes until the runner accepts');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select public.decide_training_proposal((select id from public.training_proposals where kind = 'coach'), true) $$,
  'P0002', null, 'the coach cannot accept on the runner''s behalf');

select pg_temp.act_as('9d000000-0000-4000-8000-0000000000a1');
select is(public.decide_training_proposal((select id from public.training_proposals where kind = 'coach'), true), 1,
  'the runner accepts');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select is((select status from public.training_proposals where kind = 'coach'), 'accepted', 'the coach sees the outcome');

-- Revocation.
reset role;
delete from public.user_roles where user_id = '9d000000-0000-4000-8000-0000000000c1';
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.coach_runner_list()) + (select count(*) from public.coach_notes), 0::bigint,
  'a revoked coach loses the list and notes');

-- ---------------------------------------------------------------- verification
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000d1');
select lives_ok($$ insert into public.professional_profiles (user_id, profession, headline, credentials, listed) values
  ('9d000000-0000-4000-8000-0000000000d1', 'running_coach', 'Coach', '[{"name":"Level 2","issuer":"Athletics body"}]', true) $$,
  'a coach creates a profile');
select throws_ok($$ update public.professional_profiles set verification_status = 'verified' $$, '42501', null,
  'and cannot verify themselves');
select lives_ok($$ select public.request_professional_verification() $$, 'they request review');
select throws_ok($$ select public.review_professional('9d000000-0000-4000-8000-0000000000d1', 'verified', 'ok') $$, '42501', null,
  'only admins review');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000f1');
select lives_ok($$ select public.review_professional('9d000000-0000-4000-8000-0000000000d1', 'verified', 'Licence checked') $$,
  'an admin verifies');
select pg_temp.act_as('9d000000-0000-4000-8000-0000000000d1');
select lives_ok($$ update public.professional_profiles set credentials = '[{"name":"Other"}]' $$, 'editing credentials');
select is((select verification_status from public.professional_profiles where user_id = '9d000000-0000-4000-8000-0000000000d1'), 'unverified', 'sends the profile back to unverified');

select * from finish();
rollback;
