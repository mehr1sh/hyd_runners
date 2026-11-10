-- pgTAP: experiments (migration 20261130120000_experiments): route
-- completions come only from the caller's own matching GPS tracks; mystery
-- routes stay hidden until the reveal (except to organisers); relays are
-- members-only; causes are verified only by admins.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a5000000-0000-4000-8000-0000000000a1', 'ex.a@example.test', '{"display_name":"Exp A"}', 'authenticated', 'authenticated'),
  ('a5000000-0000-4000-8000-0000000000b1', 'ex.b@example.test', '{"display_name":"Exp B"}', 'authenticated', 'authenticated'),
  ('a5000000-0000-4000-8000-0000000000f1', 'ex.m@example.test', '{"display_name":"Exp Admin"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('a5000000-0000-4000-8000-0000000000f1', 'admin');
insert into public.routes (id, slug, name, area, path, status, source, source_ref, source_attribution) values
  ('a5000000-0000-4000-8000-00000000d001', 'exp-lake-loop', 'Exp lake loop', 'Test',
   'SRID=4326;LINESTRING(78.40 17.40, 78.41 17.40, 78.42 17.40)', 'published', 'gpx', 'exp.gpx', 'GPX');
insert into public.activities (id, user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds, moving_seconds,
                               moving_source, distance_m, avg_pace_s, has_gps) values
  ('a5000000-0000-4000-8000-00000000ac01', 'a5000000-0000-4000-8000-0000000000a1', 'run', 'ready', 'gpx', now() - interval '1 day',
   now() - interval '1 day' + interval '15 minutes', 900, 900, 'derived', 2125, 420, true);
insert into public.activity_tracks (activity_id, user_id, path, samples, file_path, file_sha256, file_bytes) values
  ('a5000000-0000-4000-8000-00000000ac01', 'a5000000-0000-4000-8000-0000000000a1',
   extensions.st_geogfromtext('SRID=4326;LINESTRING(78.4001 17.4001, 78.41 17.4002, 78.4199 17.4001)'), '[]',
   'a5000000-0000-4000-8000-0000000000a1/x', repeat('a', 64), 10);

select pg_temp.act_as('a5000000-0000-4000-8000-0000000000a1');
select is((select times from public.my_route_completions() where slug = 'exp-lake-loop'), 1::bigint,
  'a matching GPS track completes the route');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.my_route_completions() where slug = 'exp-lake-loop'), 0::bigint,
  'other runners don''t get the completion');

-- Mystery run.
reset role;
insert into public.events (id, title, starts_at, ends_at, status, created_by) values
  ('a5000000-0000-4000-8000-00000000e001', 'Mystery Sunday', now() + interval '3 days', now() + interval '3 days 2 hours', 'published',
   'a5000000-0000-4000-8000-0000000000f1');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select throws_ok($$ select public.set_mystery_run('a5000000-0000-4000-8000-00000000e001', 'a5000000-0000-4000-8000-00000000d001', now() + interval '3 days') $$,
  '42501', null, 'only organisers set a mystery route');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000f1');
select lives_ok($$ select public.set_mystery_run('a5000000-0000-4000-8000-00000000e001', 'a5000000-0000-4000-8000-00000000d001', now() + interval '3 days') $$,
  'the organiser sets a mystery route');
select is((select slug from public.mystery_route('a5000000-0000-4000-8000-00000000e001')), 'exp-lake-loop', 'organisers can see it');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select is((select slug from public.mystery_route('a5000000-0000-4000-8000-00000000e001')), null, 'runners can''t before the reveal');
select ok((select distance_m > 0 from public.mystery_route('a5000000-0000-4000-8000-00000000e001')), 'but see the distance to prepare');
select throws_ok($$ select mystery_route_id from public.events $$, '42501', null, 'the hidden column can''t be selected');
select lives_ok($$ select id, title from public.events where id = 'a5000000-0000-4000-8000-00000000e001' $$, 'other event columns still can');
reset role;
update public.events set mystery_reveal_at = now() - interval '1 minute' where id = 'a5000000-0000-4000-8000-00000000e001';
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select is((select slug from public.mystery_route('a5000000-0000-4000-8000-00000000e001')), 'exp-lake-loop', 'it appears after the reveal');

-- Causes.
reset role;
insert into public.challenges (id, title, scope, kind, goal, starts_at, ends_at, created_by) values
  ('a5000000-0000-4000-8000-00000000c001', 'Cause test', 'city', 'distance', 10000, now(), now() + interval '7 days',
   'a5000000-0000-4000-8000-0000000000f1');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select throws_ok($$ select public.set_challenge_cause('a5000000-0000-4000-8000-00000000c001', 'Lake cleanup', 'https://example.org') $$,
  '42501', null, 'runners cannot attach causes');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000f1');
select lives_ok($$ select public.set_challenge_cause('a5000000-0000-4000-8000-00000000c001', 'Lake cleanup', 'https://example.org') $$,
  'organisers attach a cause');
select is((select cause_status from public.challenges where id = 'a5000000-0000-4000-8000-00000000c001'), 'pending', 'it starts pending');
select lives_ok($$ select public.verify_challenge_cause('a5000000-0000-4000-8000-00000000c001', true) $$, 'an admin verifies it');
select pg_temp.act_as('a5000000-0000-4000-8000-0000000000b1');
select throws_ok($$ select public.squad_relay_progress(gen_random_uuid()) $$, '42501', null, 'relay progress is members-only');

select * from finish();
rollback;
