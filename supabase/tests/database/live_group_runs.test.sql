-- pgTAP: live group runs (migration 20261125120000_live_group_runs): only
-- staff open a session, and only in the run's window; sharing is opt-in,
-- capped at three hours and visible only to the runner and event staff while
-- active; stopping, expiry and the end of the session delete positions; help
-- requests reach staff; the recap never singles out an individual's run.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- K captains, P and Q run, S is a stranger. The run started 10 minutes ago.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('bf000000-0000-4000-8000-0000000000c1', 'lv.k@example.test', '{"display_name":"Live Captain"}', 'authenticated', 'authenticated'),
  ('bf000000-0000-4000-8000-0000000000a1', 'lv.p@example.test', '{"display_name":"Live P"}', 'authenticated', 'authenticated'),
  ('bf000000-0000-4000-8000-0000000000b1', 'lv.q@example.test', '{"display_name":"Live Q"}', 'authenticated', 'authenticated'),
  ('bf000000-0000-4000-8000-0000000000e1', 'lv.s@example.test', '{"display_name":"Live S"}', 'authenticated', 'authenticated');
insert into public.events (id, title, starts_at, ends_at, status) values
  ('bf000000-0000-4000-8000-00000000e001', 'Live test run', now() - interval '10 minutes', now() + interval '80 minutes', 'published'),
  ('bf000000-0000-4000-8000-00000000e002', 'Next week', now() + interval '7 days', now() + interval '7 days 1 hour', 'published');
insert into public.event_team (event_id, user_id, role) values
  ('bf000000-0000-4000-8000-00000000e001', 'bf000000-0000-4000-8000-0000000000c1', 'captain'),
  ('bf000000-0000-4000-8000-00000000e002', 'bf000000-0000-4000-8000-0000000000c1', 'captain');
insert into public.event_rsvps (event_id, user_id, status) values
  ('bf000000-0000-4000-8000-00000000e001', 'bf000000-0000-4000-8000-0000000000a1', 'going'),
  ('bf000000-0000-4000-8000-00000000e001', 'bf000000-0000-4000-8000-0000000000b1', 'going');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.act_as('bf000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select public.start_live_session('bf000000-0000-4000-8000-00000000e001') $$, '42501', null,
  'participants cannot open a live session');
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select public.start_live_session('bf000000-0000-4000-8000-00000000e002') $$, '22023', null,
  'sessions only open close to the start');
select lives_ok($$ insert into ids values ('s', public.start_live_session('bf000000-0000-4000-8000-00000000e001')) $$,
  'the captain opens the live session');
select ok((select ends_at <= now() + interval '6 hours' from public.live_sessions where id = (select v from ids where k = 's')),
  'sessions are time-limited');

select pg_temp.act_as('bf000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.live_sessions), 0::bigint, 'strangers cannot see the session');
select throws_ok($$ select public.start_location_sharing((select v from ids where k = 's'), 60) $$, '42501', null,
  'and cannot share into it');

select pg_temp.act_as('bf000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.live_sessions), 1::bigint, 'participants see the session');
select is((select count(*) from public.live_positions), 0::bigint, 'nothing is shared by default');
select ok(public.start_location_sharing((select v from ids where k = 's'), 999) <= now() + interval '3 hours',
  'sharing is capped at three hours');
select is(public.update_live_position((select v from ids where k = 's'), 17.42, 78.45, 8, now()), 'ok', 'P sends a position');
select is(public.update_live_position((select v from ids where k = 's'), 17.43, 78.46, 8, now()), 'throttled',
  'updates are throttled');
select is(public.update_live_position((select v from ids where k = 's'), 17.43, 78.46, 8, now() - interval '30 minutes'), 'stale',
  'old fixes are refused');

select pg_temp.act_as('bf000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.live_positions), 0::bigint, 'other participants cannot see P''s position');
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.live_positions), 0::bigint, 'nor can strangers');
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.live_positions), 1::bigint, 'the captain sees the shared position');
select throws_ok($$ insert into public.live_positions (session_id, user_id, lat, lon, recorded_at) values
  ((select v from ids where k = 's'), 'bf000000-0000-4000-8000-0000000000a1', 1, 1, now()) $$, '42501', null,
  'positions can only be written through update_live_position');

-- Expiry hides and purges.
reset role;
update public.live_shares set expires_at = now() - interval '1 second', started_at = now() - interval '1 hour'
 where user_id = 'bf000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.live_positions), 0::bigint, 'an expired share is no longer visible to staff');
select is(public.purge_stale_live_positions(), 1, 'and its position is purged');

-- Q shares, then stops.
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000b1');
select lives_ok($$ select public.start_location_sharing((select v from ids where k = 's'), 60) $$, 'Q starts sharing');
select is(public.update_live_position((select v from ids where k = 's'), 17.4, 78.4, 12, now()), 'ok', 'Q sends a position');
select lives_ok($$ select public.stop_location_sharing((select v from ids where k = 's')) $$, 'Q stops');
select is(public.update_live_position((select v from ids where k = 's'), 17.4, 78.4, 12, now()), 'not_sharing',
  'positions are refused after stopping');
reset role;
select is((select count(*) from public.live_positions where user_id = 'bf000000-0000-4000-8000-0000000000b1'), 0::bigint,
  'stopping deletes the position');

-- Help.
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000b1');
select lives_ok($$ select public.request_live_help((select v from ids where k = 's'), 'Twisted ankle near the lake', 17.4, 78.4) $$,
  'a participant asks for help');
reset role;
select is((select count(*) from public.notifications where user_id = 'bf000000-0000-4000-8000-0000000000c1' and kind = 'live_help'),
  1::bigint, 'the captain is notified');

-- Recap privacy and pace-group leaders.
select pg_temp.act_as('bf000000-0000-4000-8000-0000000000a1');
select is(public.group_run_recap('bf000000-0000-4000-8000-00000000e001')->'distanceM', 'null'::jsonb,
  'the recap hides distance with fewer than three activities');
reset role;
insert into public.event_pace_groups (event_id, label) values ('bf000000-0000-4000-8000-00000000e001', '6:00-6:30');
select throws_ok($$ update public.event_pace_groups set leader_id = 'bf000000-0000-4000-8000-0000000000e1'
  where event_id = 'bf000000-0000-4000-8000-00000000e001' $$, '22023', null, 'pace-group leaders must be on the team');

select * from finish();
rollback;
