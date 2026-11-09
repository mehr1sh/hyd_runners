-- pgTAP: recovery and strength (migration 20261121120000_recovery_strength):
-- journal entries are private unless shared with a currently assigned coach;
-- revoking the assignment or the coach role removes access immediately;
-- strength logs are visible to the assigned coach; dates and session links
-- are guarded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- R is the runner, C coaches R, D is another coach, S is a stranger.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('8c000000-0000-4000-8000-0000000000a1', 'rc.r@example.test', '{"display_name":"Rec Runner"}', 'authenticated', 'authenticated'),
  ('8c000000-0000-4000-8000-0000000000c1', 'rc.c@example.test', '{"display_name":"Rec Coach"}', 'authenticated', 'authenticated'),
  ('8c000000-0000-4000-8000-0000000000d1', 'rc.d@example.test', '{"display_name":"Rec Other"}', 'authenticated', 'authenticated'),
  ('8c000000-0000-4000-8000-0000000000e1', 'rc.s@example.test', '{"display_name":"Rec Stranger"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-4000-8000-0000000000c1', 'coach'), ('8c000000-0000-4000-8000-0000000000d1', 'coach');
insert into public.coach_assignments (coach_id, runner_id) values
  ('8c000000-0000-4000-8000-0000000000c1', '8c000000-0000-4000-8000-0000000000a1');
insert into public.scheduled_workouts (id, user_id, title, workout_type, starts_at, duration_minutes, planned_by) values
  ('8c000000-0000-4000-8000-00000000f0d1', '8c000000-0000-4000-8000-0000000000e1', 'Not R''s', 'strength', now(), 30, 'runner');

select pg_temp.act_as('8c000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.recovery_entries (user_id, entry_date, fatigue, soreness, notes) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date, 4, 2, 'private note') $$, 'a runner logs a private entry');
select lives_ok($$ insert into public.recovery_entries (user_id, entry_date, sleep_quality, share_with_coach) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date - 1, 3, true) $$, 'and a shared one');
select throws_ok($$ insert into public.recovery_entries (user_id, entry_date, fatigue) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date, 2) $$, '23505', null, 'one entry per day');
select throws_ok($$ insert into public.recovery_entries (user_id, entry_date, fatigue) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date - 90, 2) $$, '22023', null, 'entries older than 60 days are rejected');
select throws_ok($$ insert into public.recovery_entries (user_id, entry_date) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date - 2) $$, '23514', null, 'an empty entry is rejected');
select throws_ok($$ insert into public.recovery_entries (user_id, entry_date, fatigue) values
  ('8c000000-0000-4000-8000-0000000000e1', current_date, 2) $$, '42501', null, 'nobody writes someone else''s journal');
select lives_ok($$ insert into public.strength_logs (user_id, performed_on, title, minutes, exercises) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date, 'Strength: runner foundation', 25, '[{"key":"glute_bridge","sets":3}]') $$,
  'a runner logs a strength session');
select throws_ok($$ insert into public.strength_logs (user_id, performed_on, title, minutes, exercises, scheduled_workout_id) values
  ('8c000000-0000-4000-8000-0000000000a1', current_date, 'x', 25, '[{"key":"plank","sets":1}]', '8c000000-0000-4000-8000-00000000f0d1') $$,
  '42501', null, 'a log cannot point at someone else''s session');

select pg_temp.act_as('8c000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.recovery_entries), 1::bigint, 'the assigned coach sees only the shared entry');
select is((select count(*) from public.recovery_entries where notes is not null), 0::bigint, 'not the private note');
select is((select count(*) from public.strength_logs), 1::bigint, 'the assigned coach sees strength logs');
select results_eq($$ update public.recovery_entries set fatigue = 1 returning 1 $$, $$ select 1 where false $$,
  'coaches cannot edit entries');

select pg_temp.act_as('8c000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.recovery_entries) + (select count(*) from public.strength_logs), 0::bigint,
  'an unassigned coach sees nothing');
select pg_temp.act_as('8c000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.recovery_entries), 0::bigint, 'a stranger sees nothing');

-- Revoking the coach role removes access immediately.
reset role;
delete from public.user_roles where user_id = '8c000000-0000-4000-8000-0000000000c1' and role = 'coach';
select pg_temp.act_as('8c000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.recovery_entries) + (select count(*) from public.strength_logs), 0::bigint,
  'a coach whose role was revoked loses access');

select pg_temp.act_as('8c000000-0000-4000-8000-0000000000a1');
select lives_ok($$ delete from public.recovery_entries where entry_date = current_date $$, 'the runner deletes an entry');
select lives_ok($$ insert into public.training_proposals (user_id, kind, title, summary, changes) values
  ('8c000000-0000-4000-8000-0000000000a1', 'return_to_run', 'Return', 'Walk-run', '[{"op":"cancel","workout_id":"8c000000-0000-4000-8000-00000000f0d1"}]') $$,
  'return-to-running proposals are allowed');

select * from finish();
rollback;
