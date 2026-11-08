-- pgTAP: per-user rate limits, aggregate reads and timezone validation
-- (migration 20261109140000_limits_and_correctness).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_system() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- R1, R2: runners. M: programme manager.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('3c000000-0000-4000-8000-0000000000a1', 'lim.r1@example.test', '{"display_name":"Limit Runner 1"}', 'authenticated', 'authenticated'),
  ('3c000000-0000-4000-8000-0000000000a2', 'lim.r2@example.test', '{"display_name":"Limit Runner 2"}', 'authenticated', 'authenticated'),
  ('3c000000-0000-4000-8000-0000000000d1', 'lim.m@example.test', '{"display_name":"Limit Manager"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('3c000000-0000-4000-8000-0000000000d1', 'programme_manager');
insert into public.events (id, title, starts_at, ends_at, status)
values ('3c000000-0000-4000-8000-0000000000e1', 'Limit test run', now() + interval '1 day', now() + interval '1 day 1 hour', 'published');

-- ---------------------------------------------------------------- messages
select pg_temp.act_as('3c000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     select '3c000000-0000-4000-8000-0000000000d1', '3c000000-0000-4000-8000-0000000000a1', 'note ' || n
       from generate_series(1, 20) n $$,
  'twenty messages in five minutes are accepted');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('3c000000-0000-4000-8000-0000000000d1', '3c000000-0000-4000-8000-0000000000a2', 'one more') $$,
  'PT429', 'rate_limited', 'the twenty-first message in five minutes is refused');
select is((select count(*)::int from public.messages where sender_id = '3c000000-0000-4000-8000-0000000000d1'), 20,
  'a refused message is not stored');

-- Runner R1 replies: limits are per person.
select pg_temp.act_as('3c000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('3c000000-0000-4000-8000-0000000000a1', '3c000000-0000-4000-8000-0000000000d1', 'thanks') $$,
  'another person is not affected by someone else''s limit');

-- ---------------------------------------------------------------- feedback and replies
select lives_ok(
  $$ insert into public.feedback (user_id, target, body, barrier)
     select '3c000000-0000-4000-8000-0000000000a1', 'app', 'idea ' || n, 'other' from generate_series(1, 5) n $$,
  'five feedback items an hour are accepted');
select throws_ok(
  $$ insert into public.feedback (user_id, target, body, barrier)
     values ('3c000000-0000-4000-8000-0000000000a1', 'app', 'sixth', 'other') $$,
  'PT429', 'rate_limited', 'the sixth feedback item in an hour is refused');
select lives_ok(
  $$ insert into public.feedback_replies (feedback_id, author_id, body)
     select f.id, '3c000000-0000-4000-8000-0000000000a1', 'follow-up'
       from public.feedback f, generate_series(1, 4) n
      where f.user_id = '3c000000-0000-4000-8000-0000000000a1' $$,
  'twenty replies in ten minutes are accepted');
select throws_ok(
  $$ insert into public.feedback_replies (feedback_id, author_id, body)
     select id, '3c000000-0000-4000-8000-0000000000a1', 'too many'
       from public.feedback where user_id = '3c000000-0000-4000-8000-0000000000a1' limit 1 $$,
  'PT429', 'rate_limited', 'the twenty-first reply in ten minutes is refused');

-- ---------------------------------------------------------------- uploads
select lives_ok(
  $$ insert into public.timetable_uploads (storage_path, mime_type, size_bytes)
     select '3c000000-0000-4000-8000-0000000000a1/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000
       from generate_series(1, 10) $$,
  'ten uploads an hour are accepted');
select throws_ok(
  $$ insert into public.timetable_uploads (storage_path, mime_type, size_bytes)
     values ('3c000000-0000-4000-8000-0000000000a1/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000) $$,
  'PT429', 'rate_limited', 'the eleventh upload in an hour is refused');

-- ---------------------------------------------------------------- RSVPs
-- The app upserts: each click is one statement and counts once.
select lives_ok(
  $$ do $d$ begin
       for i in 1..20 loop
         insert into public.event_rsvps (event_id, user_id, status)
         values ('3c000000-0000-4000-8000-0000000000e1', '3c000000-0000-4000-8000-0000000000a1',
                 case when i % 2 = 1 then 'going' else 'cancelled' end)
         on conflict (event_id, user_id) do update set status = excluded.status;
       end loop;
     end $d$ $$,
  'twenty RSVP clicks (upserts) in ten minutes are accepted');
select throws_ok(
  $$ update public.event_rsvps set status = 'going'
      where event_id = '3c000000-0000-4000-8000-0000000000e1' and user_id = '3c000000-0000-4000-8000-0000000000a1' $$,
  'PT429', 'rate_limited', 'the twenty-first RSVP change is refused');

-- ---------------------------------------------------------------- server-side workout limit
select throws_ok(
  $$ select public.consume_rate_limit('3c000000-0000-4000-8000-0000000000a1', 'workout') $$,
  '42501', null, 'signed-in users cannot call the server-side limiter');
select pg_temp.as_system();
select set_config('role', 'service_role', true);
select lives_ok(
  $$ select public.consume_rate_limit('3c000000-0000-4000-8000-0000000000a2', 'workout') from generate_series(1, 10) $$,
  'the server can record ten workouts in ten minutes for a runner');
select throws_ok(
  $$ select public.consume_rate_limit('3c000000-0000-4000-8000-0000000000a2', 'workout') $$,
  'PT429', 'rate_limited', 'the eleventh workout in ten minutes is refused');
select lives_ok(
  $$ select public.consume_rate_limit('3c000000-0000-4000-8000-0000000000a1', 'workout') $$,
  'workout limits are per runner');
select throws_ok(
  $$ select public.consume_rate_limit('3c000000-0000-4000-8000-0000000000a1', 'anything') $$,
  '22023', null, 'unknown buckets are rejected');

-- Writes without a signed-in user (service role, migrations) are not limited by the triggers.
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     select '3c000000-0000-4000-8000-0000000000d1', '3c000000-0000-4000-8000-0000000000a2', 'system ' || n
       from generate_series(1, 30) n $$,
  'server-side writes are not limited by the user triggers');
reset role;

select pg_temp.act_as('3c000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select count(*) from private.rate_limit_events $$, '42501', null,
  'signed-in users cannot read the rate-limit counters');

-- ---------------------------------------------------------------- aggregate reads
select pg_temp.as_system();
insert into public.xp_ledger (user_id, delta_xp, delta_coins, reason, award_key, occurred_at)
select '3c000000-0000-4000-8000-0000000000a1', 2, 1, 'workout_completed', 'limit-test:' || n, now() - (n || ' minutes')::interval
  from generate_series(1, 1500) n;
insert into public.xp_ledger (user_id, delta_xp, delta_coins, reason, award_key, occurred_at)
values ('3c000000-0000-4000-8000-0000000000a2', 999, 9, 'workout_completed', 'limit-test:other', now());
insert into public.workout_logs (user_id, status, title, workout_type, started_at, completed_at, duration_seconds, idempotency_key)
values
  ('3c000000-0000-4000-8000-0000000000a1', 'completed', 'Run', 'run', '2026-11-01 07:00+05:30', '2026-11-01 07:30+05:30', 1800, gen_random_uuid()),
  ('3c000000-0000-4000-8000-0000000000a1', 'completed', 'Run', 'run', '2026-11-01 18:00+05:30', '2026-11-01 18:30+05:30', 1800, gen_random_uuid()),
  ('3c000000-0000-4000-8000-0000000000a1', 'completed', 'Walk', 'walk', '2026-11-02 23:30+05:30', '2026-11-02 23:35+05:30', 300, gen_random_uuid()),
  ('3c000000-0000-4000-8000-0000000000a1', 'completed', 'Run', 'run', '2026-11-03 23:00+00:00', '2026-11-03 23:30+00:00', 1800, gen_random_uuid()),
  ('3c000000-0000-4000-8000-0000000000a2', 'completed', 'Run', 'run', '2026-11-05 07:00+05:30', '2026-11-05 07:30+05:30', 1800, gen_random_uuid());

select pg_temp.act_as('3c000000-0000-4000-8000-0000000000a1');
select is(
  (select total_xp || ':' || total_coins || ':' || ledger_rows from public.my_reward_totals()),
  '3000:1500:1500', 'reward totals cover every ledger row (beyond the 1000-row API page) and only the caller''s');
select is(
  public.my_active_dates('Asia/Kolkata', 0),
  array['2026-11-01', '2026-11-02', '2026-11-04']::date[],
  'active dates are distinct local dates in the given timezone');
select is(
  public.my_active_dates('Asia/Kolkata', 600),
  array['2026-11-01', '2026-11-04']::date[],
  'active dates respect the minimum duration');
select is(
  public.my_active_dates('UTC', 0),
  array['2026-11-01', '2026-11-02', '2026-11-03']::date[],
  'active dates follow the timezone passed in');
select pg_temp.act_as('3c000000-0000-4000-8000-0000000000a2');
select is((select total_xp from public.my_reward_totals()), 999::bigint, 'each runner sees only their own totals');
reset role;
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('my_reward_totals', 'my_active_dates', 'consume_rate_limit')
      and grantee = 'anon'),
  0, 'signed-out visitors cannot call the aggregate or limiter functions');

-- ---------------------------------------------------------------- timezones
select pg_temp.act_as('3c000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$ update public.profiles set timezone = 'Mars/Olympus_Mons' where id = '3c000000-0000-4000-8000-0000000000a2' $$,
  '22023', null, 'an unknown profile timezone is rejected');
select throws_ok(
  $$ update public.profiles set timezone = '' where id = '3c000000-0000-4000-8000-0000000000a2' $$,
  '22023', null, 'an empty profile timezone is rejected');
select lives_ok(
  $$ update public.profiles set timezone = 'Europe/London' where id = '3c000000-0000-4000-8000-0000000000a2' $$,
  'a real IANA timezone is accepted');
select lives_ok(
  $$ update public.profiles set display_name = 'Renamed' where id = '3c000000-0000-4000-8000-0000000000a2' $$,
  'other profile edits are unaffected');
select throws_ok(
  $$ insert into public.user_preferences (user_id, goal, sessions_per_week, max_session_minutes, timezone)
     values ('3c000000-0000-4000-8000-0000000000a2', 'build_habit', 3, 30, 'Nowhere/Land') $$,
  '22023', null, 'an unknown preferences timezone is rejected');
select lives_ok(
  $$ insert into public.user_preferences (user_id, goal, sessions_per_week, max_session_minutes, timezone)
     values ('3c000000-0000-4000-8000-0000000000a2', 'build_habit', 3, 30, 'Asia/Kolkata') $$,
  'a valid preferences timezone is accepted');
reset role;
select is(
  (select count(*)::int from public.profiles where not private.is_valid_timezone(timezone)), 0,
  'no stored profile has an unknown timezone');
select lives_ok(
  $$ select * from public.weekly_leaderboard((date_trunc('week', now() at time zone 'Europe/London'))::date, 'Europe/London', 5) $$,
  'the leaderboard runs for a validated non-default timezone');

select * from finish();
rollback;
