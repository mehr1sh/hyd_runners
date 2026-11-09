-- pgTAP: activities (migration 20261114120000_activities): client write
-- limits, service-only finalisation, duplicates, manual-log reconciliation,
-- visibility, owner-only tracks, privacy trimming and upload limits.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
-- A ~2.2 km straight line, starting at `start`.
create function pg_temp.payload(start timestamptz, sha text, dist numeric default 2200) returns jsonb language sql as $$
  select jsonb_build_object(
    'format', 'gpx', 'name', 'Morning run', 'sha256', sha, 'filePath', 'x/y', 'fileBytes', 1000,
    'startedAt', start, 'endedAt', start + interval '12 minutes', 'elapsedSeconds', 720, 'movingSeconds', 700,
    'movingSource', 'derived', 'distanceMeters', dist, 'avgPace', 318, 'hasGps', true,
    'kmSplits', '[]'::jsonb, 'mileSplits', '[]'::jsonb, 'bestEfforts', '{"1k": 300}'::jsonb,
    'samples', '[[0, 17.42, 78.42, null, 0]]'::jsonb,
    'pathWkt', 'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200, 78.4400 17.4200)',
    'publicPathWkt', 'SRID=4326;LINESTRING(78.4220 17.4200, 78.4380 17.4200)');
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('8b000000-0000-4000-8000-0000000000a1', 'ac.a@example.test', '{"display_name":"Ac Runner"}', 'authenticated', 'authenticated'),
  ('8b000000-0000-4000-8000-0000000000a2', 'ac.b@example.test', '{"display_name":"Ac Other"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- client limits
select pg_temp.act_as('8b000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.activities (id, user_id, activity_type, visibility) values
       ('8b000000-0000-4000-8000-0000000000f1', '8b000000-0000-4000-8000-0000000000a1', 'run', 'public') $$,
  'a runner registers an upload');
select throws_ok(
  $$ insert into public.activities (user_id, status, distance_m) values ('8b000000-0000-4000-8000-0000000000a1', 'ready', 5000) $$,
  '42501', null, 'a runner cannot insert metrics or a status');
select throws_ok(
  $$ insert into public.activities (user_id) values ('8b000000-0000-4000-8000-0000000000a2') $$,
  '42501', null, 'nobody registers uploads for someone else');
select throws_ok(
  $$ update public.activities set distance_m = 42195 where id = '8b000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'a runner cannot change metrics');
select throws_ok(
  $$ select public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f1', pg_temp.payload(now() - interval '1 day', repeat('a', 64))) $$,
  '42501', null, 'runners cannot call the finaliser');

-- ---------------------------------------------------------------- finalisation
select pg_temp.as_service();
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f1', pg_temp.payload('2026-11-05 06:00+05:30', repeat('a', 64))) ->> 'status',
  'ready', 'the server finalises a processed activity');
reset role;
select is((select status || ':' || distance_m::text from public.activities where id = '8b000000-0000-4000-8000-0000000000f1'), 'ready:2200.0',
  'metrics are stored');
select is((select source || ':' || distance_meters::text || ':' || duration_seconds::text from public.workout_logs
            where id = (select workout_log_id from public.activities where id = '8b000000-0000-4000-8000-0000000000f1')),
  'import:2200:720', 'a workout log is created for rewards, once');
select pg_temp.as_service();
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f1', pg_temp.payload('2026-11-05 06:00+05:30', repeat('a', 64))) ->> 'alreadyProcessed',
  'true', 'finalising again is a no-op');
reset role;
select is((select count(*)::int from public.workout_logs where user_id = '8b000000-0000-4000-8000-0000000000a1'), 1, 'still one workout log');

-- ---------------------------------------------------------------- duplicates
insert into public.activities (id, user_id) values
  ('8b000000-0000-4000-8000-0000000000f2', '8b000000-0000-4000-8000-0000000000a1'),
  ('8b000000-0000-4000-8000-0000000000f3', '8b000000-0000-4000-8000-0000000000a1'),
  ('8b000000-0000-4000-8000-0000000000f4', '8b000000-0000-4000-8000-0000000000a1');
select pg_temp.as_service();
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f2', pg_temp.payload('2026-11-07 06:00+05:30', repeat('a', 64))) ->> 'status',
  'duplicate', 'the same file is a duplicate');
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f3', pg_temp.payload('2026-11-05 06:00:30+05:30', repeat('b', 64), 2210)) ->> 'status',
  'duplicate', 'a different file of the same run (start within 60 s, distance within 3%) is a duplicate');
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f4', pg_temp.payload('2026-11-05 18:00+05:30', repeat('c', 64))) ->> 'status',
  'ready', 'the same distance later that day is a separate run');
reset role;
select is((select failure_reason from public.activities where id = '8b000000-0000-4000-8000-0000000000f3'),
  'duplicate:8b000000-0000-4000-8000-0000000000f1', 'the duplicate points at the original');

-- ---------------------------------------------------------------- manual reconciliation
insert into public.workout_logs (id, user_id, status, title, workout_type, started_at, completed_at, duration_seconds, distance_meters, source, idempotency_key)
values ('8b000000-0000-4000-8000-0000000000e1', '8b000000-0000-4000-8000-0000000000a1', 'completed', 'Logged by hand', 'run',
        '2026-11-06 06:05+05:30', '2026-11-06 06:35+05:30', 1800, 5000, 'manual', gen_random_uuid());
insert into public.activities (id, user_id) values ('8b000000-0000-4000-8000-0000000000f5', '8b000000-0000-4000-8000-0000000000a1');
select pg_temp.as_service();
select is(
  public.finalize_activity_import('8b000000-0000-4000-8000-0000000000f5', pg_temp.payload('2026-11-06 06:00+05:30', repeat('d', 64), 5020)) ->> 'linkedExisting',
  'true', 'an import of a hand-logged run links to that log');
reset role;
select is((select workout_log_id::text from public.activities where id = '8b000000-0000-4000-8000-0000000000f5'),
  '8b000000-0000-4000-8000-0000000000e1', 'it reuses the manual log');
select is((select count(*)::int from public.workout_logs where user_id = '8b000000-0000-4000-8000-0000000000a1'), 3,
  'no extra log is created (two imports, one manual)');
select is((select title from public.workout_logs where id = '8b000000-0000-4000-8000-0000000000e1'), 'Logged by hand',
  'the manual log is not changed');

-- ---------------------------------------------------------------- visibility and tracks
update public.activities set visibility = 'private' where id = '8b000000-0000-4000-8000-0000000000f4';
select pg_temp.act_as('8b000000-0000-4000-8000-0000000000a2');
select is((select array_agg(id::text order by id) from public.activities where user_id = '8b000000-0000-4000-8000-0000000000a1'),
  '{8b000000-0000-4000-8000-0000000000f1}', 'others see only the ready public activity');
select is((select count(*)::int from public.activity_tracks), 0, 'others never see tracks, samples or heart rate');
select is((select count(*)::int from public.workout_logs where user_id = '8b000000-0000-4000-8000-0000000000a1'), 0,
  'others cannot see the linked workout logs');
update public.activities set visibility = 'private' where id = '8b000000-0000-4000-8000-0000000000f1';
reset role;
select is((select visibility from public.activities where id = '8b000000-0000-4000-8000-0000000000f1'), 'public', 'others cannot edit it');

select pg_temp.act_as('8b000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.activity_tracks), 3, 'the owner reads their own tracks');
select lives_ok($$ update public.activities set privacy_trim_m = 1000 where id = '8b000000-0000-4000-8000-0000000000f1' $$,
  'the owner hides more of the start and end');
select ok(
  (select extensions.st_length(public_path) between 100 and 150 from public.activities where id = '8b000000-0000-4000-8000-0000000000f1'),
  'the shared route is recomputed from the full track (2.12 km less 2 × 1 km)');

-- ---------------------------------------------------------------- upload limits
select lives_ok(
  $$ insert into public.activities (user_id) select '8b000000-0000-4000-8000-0000000000a1' from generate_series(1, 19) $$,
  'twenty uploads an hour are accepted');
select throws_ok(
  $$ insert into public.activities (user_id) values ('8b000000-0000-4000-8000-0000000000a1') $$,
  'PT429', 'rate_limited', 'the twenty-first upload in an hour is refused');

select * from finish();
rollback;
