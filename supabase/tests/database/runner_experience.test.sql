-- pgTAP: runner experience tables (programmes, workouts, rewards, RSVPs, leaderboard).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Users: A (runner), B (runner, hidden from leaderboard), C (runner)
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@example.test', '{"display_name":"Runner A"}', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'b@example.test', '{"display_name":"Runner B"}', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'c@example.test', '{"display_name":"Runner C"}', 'authenticated', 'authenticated');

select ok((select count(*) from public.programmes where published) >= 7, 'programme catalogue is seeded');
select is((select count(*)::int from public.programme_sessions s join public.programmes p on p.id = s.programme_id where p.slug = 'couch-to-5k'), 27, 'Couch to 5K has 27 sessions');

-- The leaderboard is a top-N over everyone's XP, so XP left by local E2E
-- runs could push the fixture runners out of it. Remove other users' recent
-- ledger rows inside this transaction (rolled back at the end) so the
-- leaderboard checks depend only on the fixtures.
delete from public.xp_ledger where occurred_at > now() - interval '30 days' and user_id::text not like 'aaaaaaaa-0000-4000-8000-%';

-- Server-side (postgres) writes: workouts and ledger for A and B this week, C last week.
insert into public.workout_logs (id, user_id, status, title, workout_type, started_at, completed_at, duration_seconds, idempotency_key)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'completed', 'Run', 'run', now() - interval '1 hour', now() - interval '30 minutes', 1800, gen_random_uuid()),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'completed', 'Run', 'run', now() - interval '2 hours', now() - interval '90 minutes', 1800, gen_random_uuid());
insert into public.xp_ledger (user_id, delta_xp, delta_coins, reason, award_key, occurred_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 26, 5, 'workout_completed', 'workout:day:x', now()),
  ('aaaaaaaa-0000-4000-8000-000000000002', 40, 5, 'workout_completed', 'workout:day:x', now()),
  ('aaaaaaaa-0000-4000-8000-000000000003', 99, 5, 'workout_completed', 'workout:day:y', now() - interval '14 days');
insert into public.runner_settings (user_id, show_on_leaderboard) values ('aaaaaaaa-0000-4000-8000-000000000002', false);

select throws_ok(
  $$ insert into public.xp_ledger (user_id, delta_xp, reason, award_key, occurred_at)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 26, 'workout_completed', 'workout:day:x', now()) $$,
  '23505', null, 'the same award key cannot be paid twice');

-- Act as runner A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.xp_ledger), 1, 'runner reads only their own ledger rows');
select throws_ok(
  $$ insert into public.workout_logs (user_id, title, workout_type, started_at, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'x', 'run', now(), gen_random_uuid()) $$,
  '42501', null, 'runners cannot write workout logs directly');
-- Workouts are reward inputs: no direct edits or deletes, own or anyone else's.
select is((select array_agg(id)::text from public.workout_logs), '{bbbbbbbb-0000-4000-8000-000000000001}',
  'runner reads only their own workouts');
select throws_ok(
  $$ update public.workout_logs set duration_seconds = 21600 where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  '42501', null, 'runners cannot edit their own workout directly');
select throws_ok(
  $$ update public.workout_logs set title = 'mine now' where id = 'bbbbbbbb-0000-4000-8000-000000000002' $$,
  '42501', null, 'runners cannot edit another runner''s workout');
select throws_ok(
  $$ delete from public.workout_logs where id = 'bbbbbbbb-0000-4000-8000-000000000002' $$,
  '42501', null, 'runners cannot delete another runner''s workout');
select throws_ok(
  $$ insert into public.workout_logs (user_id, status, title, workout_type, started_at, completed_at, duration_seconds, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000002', 'completed', 'x', 'run', now() - interval '1 hour', now(), 3600, gen_random_uuid()) $$,
  '42501', null, 'runners cannot create workouts for another runner');
select throws_ok(
  $$ insert into public.xp_ledger (user_id, delta_xp, reason, award_key, occurred_at)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 1000, 'admin_adjustment', 'cheat', now()) $$,
  '42501', null, 'runners cannot award themselves XP');
select throws_ok(
  $$ insert into public.user_badges (user_id, badge_code, earned_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'c25k-graduate', now()) $$,
  '42501', null, 'runners cannot grant themselves badges');

-- Enrolment status is decided by the programme, not the runner.
insert into public.enrollments (user_id, programme_id, status)
select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'completed' from public.programmes where slug = 'couch-to-5k';
select is((select status from public.enrollments e join public.programmes p on p.id = e.programme_id where p.slug = 'couch-to-5k'), 'active', 'open programmes start active whatever status is sent');
insert into public.enrollments (user_id, programme_id)
select 'aaaaaaaa-0000-4000-8000-000000000001', id from public.programmes where slug = 'training-and-shine';
select is((select status from public.enrollments e join public.programmes p on p.id = e.programme_id where p.slug = 'training-and-shine'), 'requested', 'coach-led programmes start as a request');
select throws_ok(
  $$ update public.enrollments set status = 'active' where status = 'requested' $$,
  '42501', null, 'runners cannot approve their own coach-led request');

-- Leaderboard: A sees self and C is out of this week; B opted out.
select is(
  (select array_agg(display_name order by rank)::text from public.weekly_leaderboard(
     (date_trunc('week', now() at time zone 'Asia/Kolkata'))::date) where display_name like 'Runner %'),
  '{"Runner A"}',
  'leaderboard hides opted-out runners and other weeks');

-- As B (opted out), B still sees their own row, ranked by XP among visible rows.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select array_agg(display_name || ':' || is_me order by rank)::text from public.weekly_leaderboard(
     (date_trunc('week', now() at time zone 'Asia/Kolkata'))::date) where display_name like 'Runner %'),
  '{"Runner B:true","Runner A:false"}',
  'opted-out runner still sees themselves, ranked by XP');

-- RSVPs and capacity
reset role;
insert into public.events (id, title, starts_at, ends_at, capacity, status)
values ('cccccccc-0000-4000-8000-000000000001', 'Tiny run', now() + interval '1 day', now() + interval '1 day 1 hour', 1, 'published');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.event_rsvps (event_id, user_id) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');
select is((select going::int from public.event_attendance(array['cccccccc-0000-4000-8000-000000000001'::uuid])), 1, 'attendance counts going RSVPs');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_like(
  $$ insert into public.event_rsvps (event_id, user_id) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  '%full%', 'a full event rejects new RSVPs');
select is((select count(*)::int from public.event_rsvps), 0, 'runners cannot see other runners'' RSVPs');

-- A cancels, C can now join.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.event_rsvps set status = 'cancelled' where event_id = 'cccccccc-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.event_rsvps (event_id, user_id) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  'a freed place can be taken');

reset role;
select * from finish();
rollback;
