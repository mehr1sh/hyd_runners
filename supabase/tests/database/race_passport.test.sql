-- pgTAP: race passport (migration 20261127120000_race_passport): entries are
-- private, results keep their source, partners are opt-in and exclude blocked
-- runners, QR check-in tokens are server-generated and only staff can use
-- them, volunteers are not staff, and sponsors are organiser-managed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- A, B and D run the same race; S is a stranger; O organises; V volunteers.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('d2000000-0000-4000-8000-0000000000a1', 'rp.a@example.test', '{"display_name":"Race A"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-0000000000b1', 'rp.b@example.test', '{"display_name":"Race B"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-0000000000d1', 'rp.d@example.test', '{"display_name":"Race D"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-0000000000e1', 'rp.s@example.test', '{"display_name":"Race S"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-0000000000f1', 'rp.o@example.test', '{"display_name":"Race O"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-0000000000c1', 'rp.v@example.test', '{"display_name":"Race V"}', 'authenticated', 'authenticated');
insert into public.events (id, title, starts_at, ends_at, status, created_by) values
  ('d2000000-0000-4000-8000-00000000e001', 'City 10K', now() + interval '1 hour', now() + interval '3 hours', 'published',
   'd2000000-0000-4000-8000-0000000000f1');
insert into public.event_team (event_id, user_id, role) values
  ('d2000000-0000-4000-8000-00000000e001', 'd2000000-0000-4000-8000-0000000000f1', 'organiser'),
  ('d2000000-0000-4000-8000-00000000e001', 'd2000000-0000-4000-8000-0000000000c1', 'volunteer');
insert into public.user_blocks (blocker_id, blocked_id) values ('d2000000-0000-4000-8000-0000000000a1', 'd2000000-0000-4000-8000-0000000000d1');
insert into public.activities (id, user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds, moving_seconds,
                               moving_source, distance_m, avg_pace_s, has_gps) values
  ('d2000000-0000-4000-8000-00000000ac01', 'd2000000-0000-4000-8000-0000000000a1', 'run', 'ready', 'gpx', now() - interval '1 day',
   now() - interval '1 day' + interval '52 minutes', 3120, 3100, 'derived', 10000, 310, false),
  ('d2000000-0000-4000-8000-00000000ac02', 'd2000000-0000-4000-8000-0000000000b1', 'run', 'ready', 'gpx', now() - interval '1 day',
   now() - interval '1 day' + interval '50 minutes', 3000, 3000, 'derived', 10000, 300, false);
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.act_as('d2000000-0000-4000-8000-0000000000a1');
select lives_ok($$ with x as (insert into public.race_entries (event_id, name, race_date, distance, distance_m, status, target_seconds,
  bib, emergency_name, emergency_phone, find_partners) values ('d2000000-0000-4000-8000-00000000e001', 'City 10K', current_date, '10k',
  10000, 'registered', 3000, 'A123', 'Asha', '+91 98765 43210', true) returning id) insert into ids select 'a', id from x $$,
  'a runner adds a race to their passport');
select throws_ok($$ insert into public.race_entries (name, race_date, distance, distance_m, emergency_phone) values
  ('Bad phone', current_date, '5k', 5000, 'call me') $$, '23514', null, 'emergency phone numbers are validated');
select throws_ok($$ update public.race_entries set result_source = 'organizer_verified', result_seconds = 3000 $$, '23514', null,
  'runners cannot mark a result as organiser-verified');
select lives_ok($$ update public.race_entries set result_activity_id = 'd2000000-0000-4000-8000-00000000ac01' where id = (select v from ids where k = 'a') $$,
  'a runner links their own activity as the result');
select is((select result_seconds || ':' || result_source from public.race_entries where id = (select v from ids where k = 'a')),
  '3120:imported_activity', 'the time comes from the activity and keeps its source');
select throws_ok($$ update public.race_entries set result_activity_id = 'd2000000-0000-4000-8000-00000000ac02' $$, '42501', null,
  'not someone else''s activity');

select pg_temp.act_as('d2000000-0000-4000-8000-0000000000b1');
select lives_ok($$ insert into public.race_entries (event_id, name, race_date, distance, distance_m, target_seconds, find_partners)
  values ('d2000000-0000-4000-8000-00000000e001', 'City 10K', current_date, '10k', 10000, 3150, true) $$, 'B opts into partners');
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000d1');
select lives_ok($$ insert into public.race_entries (event_id, name, race_date, distance, distance_m, target_seconds, find_partners)
  values ('d2000000-0000-4000-8000-00000000e001', 'City 10K', current_date, '10k', 10000, 3000, true) $$, 'D opts in too');
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.race_entries), 0::bigint, 'entries are private');
select is((select count(*) from public.race_partners((select v from ids where k = 'a'))), 0::bigint,
  'nobody can list partners for someone else''s entry');

select pg_temp.act_as('d2000000-0000-4000-8000-0000000000a1');
select is((select array_agg(display_name) from public.race_partners((select v from ids where k = 'a'))), array['Race B'],
  'partners: same race, similar target, blocked runners excluded');
select ok(not exists (select 1 from public.race_partners((select v from ids where k = 'a')) p where p.display_name = 'Race D'),
  'blocked runners never appear');

-- QR check-in.
reset role;
insert into public.event_rsvps (event_id, user_id, status, checkin_token) values
  ('d2000000-0000-4000-8000-00000000e001', 'd2000000-0000-4000-8000-0000000000a1', 'going', '00000000-0000-4000-8000-000000000001');
select isnt((select checkin_token from public.event_rsvps where user_id = 'd2000000-0000-4000-8000-0000000000a1'),
  '00000000-0000-4000-8000-000000000001'::uuid, 'check-in tokens are generated by the database');
insert into ids select 'tok', checkin_token from public.event_rsvps where user_id = 'd2000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000a1');
select is((select checkin_token from public.event_rsvps where user_id = 'd2000000-0000-4000-8000-0000000000a1'), (select v from ids where k = 'tok'),
  'runners can read their own token for the QR code');
select throws_ok($$ select public.check_in_by_token('d2000000-0000-4000-8000-00000000e001', (select v from ids where k = 'tok')) $$,
  '42501', null, 'runners cannot check themselves in');
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select public.check_in_by_token('d2000000-0000-4000-8000-00000000e001', (select v from ids where k = 'tok')) $$,
  '42501', null, 'volunteers are not check-in staff');
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.check_in_by_token('d2000000-0000-4000-8000-00000000e001', gen_random_uuid()) $$, 'P0002', null,
  'unknown codes are rejected');
select is(public.check_in_by_token('d2000000-0000-4000-8000-00000000e001', (select v from ids where k = 'tok')), 'Race A',
  'the organiser checks a runner in by scanning');
select ok((select checked_in_at is not null from public.event_rsvps where user_id = 'd2000000-0000-4000-8000-0000000000a1'),
  'and the check-in is recorded');

-- Sponsors.
select lives_ok($$ insert into public.event_sponsors (event_id, name, url, tier) values
  ('d2000000-0000-4000-8000-00000000e001', 'Lakeside Cafe', 'https://example.org', 'supporter') $$, 'organisers add sponsors');
select pg_temp.act_as('d2000000-0000-4000-8000-0000000000a1');
select throws_ok($$ insert into public.event_sponsors (event_id, name) values ('d2000000-0000-4000-8000-00000000e001', 'Mine') $$,
  '42501', null, 'runners cannot');

select * from finish();
rollback;
