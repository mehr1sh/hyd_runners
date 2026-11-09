-- pgTAP: recorded activities (migration 20261122120000_recorded_activities):
-- one activity per runner and client_ref, client_ref is fixed once set,
-- runners cannot write another runner's recording, and recorded runs finalise
-- through the same service-only path as file imports.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('9c000000-0000-4000-8000-0000000000a1', 'rec.a@example.test', '{"display_name":"Rec Runner"}', 'authenticated', 'authenticated'),
  ('9c000000-0000-4000-8000-0000000000b1', 'rec.b@example.test', '{"display_name":"Rec Other"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- idempotency
select pg_temp.act_as('9c000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.activities (id, user_id, activity_type, client_ref, import_source) values
       ('9c000000-0000-4000-8000-0000000000f1', '9c000000-0000-4000-8000-0000000000a1', 'run',
        '9c000000-0000-4000-8000-00000000c0f1', 'app') $$,
  'a runner registers an app recording with a client reference');
select throws_ok(
  $$ insert into public.activities (user_id, activity_type, client_ref, import_source) values
       ('9c000000-0000-4000-8000-0000000000a1', 'run', '9c000000-0000-4000-8000-00000000c0f1', 'app') $$,
  '23505', null, 'the same client reference cannot be inserted twice for one runner');
select throws_ok(
  $$ insert into public.activities (user_id, activity_type, client_ref) values
       ('9c000000-0000-4000-8000-0000000000a1', 'run', '9c000000-0000-4000-8000-00000000c0f2') $$,
  '23514', null, 'a client reference is only valid on an app recording');
select lives_ok(
  $$ insert into public.activities (user_id, activity_type) values ('9c000000-0000-4000-8000-0000000000a1', 'run'),
                                                                   ('9c000000-0000-4000-8000-0000000000a1', 'walk') $$,
  'file uploads without a client reference are unaffected');
select throws_ok(
  $$ update public.activities set client_ref = '9c000000-0000-4000-8000-00000000c0f3'
      where id = '9c000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'the client reference cannot be changed afterwards');
select throws_ok(
  $$ update public.activities set import_source = 'upload' where id = '9c000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'the import source cannot be changed afterwards');

-- ---------------------------------------------------------------- other runners
select pg_temp.act_as('9c000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$ insert into public.activities (user_id, activity_type, client_ref, import_source) values
       ('9c000000-0000-4000-8000-0000000000a1', 'run', '9c000000-0000-4000-8000-00000000c0f9', 'app') $$,
  '42501', null, 'nobody registers a recording on someone else''s behalf');
select is(
  (select count(*) from public.activities where client_ref = '9c000000-0000-4000-8000-00000000c0f1'), 0::bigint,
  'another runner cannot see a private recording by its client reference');
select lives_ok(
  $$ insert into public.activities (user_id, activity_type, client_ref, import_source) values
       ('9c000000-0000-4000-8000-0000000000b1', 'run', '9c000000-0000-4000-8000-00000000c0f1', 'app') $$,
  'client references are scoped per runner, so a colliding one cannot block another runner');
select results_eq(
  $$ with d as (delete from public.activities where id = '9c000000-0000-4000-8000-0000000000f1' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$, 'another runner cannot delete the recording');

-- ---------------------------------------------------------------- finalisation
select throws_ok(
  $$ select public.finalize_activity_import('9c000000-0000-4000-8000-0000000000f1', '{}'::jsonb) $$,
  '42501', null, 'runners cannot finalise a recording themselves');

select pg_temp.as_service();
select is(
  public.finalize_activity_import('9c000000-0000-4000-8000-0000000000f1', jsonb_build_object(
    'format', 'app', 'name', 'Morning run', 'sha256', repeat('ab', 32), 'filePath', 'x/y', 'fileBytes', 1000,
    'startedAt', '2026-11-20 06:00+05:30'::timestamptz, 'endedAt', '2026-11-20 06:12+05:30'::timestamptz,
    'elapsedSeconds', 720, 'movingSeconds', 700, 'movingSource', 'device', 'distanceMeters', 2200, 'avgPace', 318,
    'hasGps', true, 'kmSplits', '[]'::jsonb, 'mileSplits', '[]'::jsonb, 'bestEfforts', '{"1k": 300}'::jsonb,
    'samples', '[[0, 17.42, 78.42, null, 0]]'::jsonb,
    'pathWkt', 'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200, 78.4400 17.4200)',
    'publicPathWkt', null)) ->> 'status',
  'ready', 'the service role finalises an app recording');
select is(
  (select source_format || '/' || import_source from public.activities where id = '9c000000-0000-4000-8000-0000000000f1'),
  'app/app', 'the recording is stored as an app activity');

select * from finish();
rollback;
