-- pgTAP: Events v2 (migration 20261110120000_events_v2): event teams,
-- organiser scoping, waiting lists, check-in, pace groups, announcements
-- and private results.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_system() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- M manager; O organiser; K captain; A, B, C runners; X unrelated runner.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('4d000000-0000-4000-8000-0000000000d1', 'ev.m@example.test', '{"display_name":"Ev Manager"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000b1', 'ev.o@example.test', '{"display_name":"Ev Organiser"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000b2', 'ev.k@example.test', '{"display_name":"Ev Captain"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000a1', 'ev.a@example.test', '{"display_name":"Ev Runner A"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000a2', 'ev.b@example.test', '{"display_name":"Ev Runner B"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000a3', 'ev.c@example.test', '{"display_name":"Ev Runner C"}', 'authenticated', 'authenticated'),
  ('4d000000-0000-4000-8000-0000000000a9', 'ev.x@example.test', '{"display_name":"Ev Outsider"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('4d000000-0000-4000-8000-0000000000d1', 'programme_manager');

insert into public.events (id, title, starts_at, ends_at, capacity, status, created_by) values
  ('4d000000-0000-4000-8000-0000000000e1', 'Ev Club 5K', now() + interval '1 hour', now() + interval '2 hours', 1, 'published', '4d000000-0000-4000-8000-0000000000d1'),
  ('4d000000-0000-4000-8000-0000000000e2', 'Ev Other run', now() + interval '3 days', now() + interval '3 days 1 hour', null, 'published', '4d000000-0000-4000-8000-0000000000d1'),
  ('4d000000-0000-4000-8000-0000000000e3', 'Ev Draft', now() + interval '5 days', now() + interval '5 days 1 hour', null, 'draft', '4d000000-0000-4000-8000-0000000000d1'),
  ('4d000000-0000-4000-8000-0000000000e4', 'Ev Next month', now() + interval '30 days', now() + interval '30 days 1 hour', 10, 'published', '4d000000-0000-4000-8000-0000000000d1');

-- ---------------------------------------------------------------- categories
select is((select category from public.events where id = '4d000000-0000-4000-8000-0000000000e1'), 'group_run',
  'events default to the group_run category');
select throws_ok($$ update public.events set category = 'party' where id = '4d000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'unknown categories are rejected');
select is((select count(*)::int from public.events where id::text like '5eed0002-%' and category = 'beginner'
             and not (title ilike '%beginner%' or title ilike '%walk-run%' or title ilike '%walk run%')), 0,
  'only beginner and walk-run sample events were recategorised');

-- ---------------------------------------------------------------- event teams
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ insert into public.event_team (event_id, user_id, role, added_by) values
       ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000b1', 'organiser', '4d000000-0000-4000-8000-0000000000d1'),
       ('4d000000-0000-4000-8000-0000000000e3', '4d000000-0000-4000-8000-0000000000b1', 'organiser', '4d000000-0000-4000-8000-0000000000d1') $$,
  'a manager makes someone an organiser');

select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$ insert into public.event_team (event_id, user_id, role, added_by)
     values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000b2', 'captain', '4d000000-0000-4000-8000-0000000000b1') $$,
  'an organiser adds a captain to their event');
select throws_ok(
  $$ insert into public.event_team (event_id, user_id, role, added_by)
     values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a1', 'organiser', '4d000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'an organiser cannot create more organisers');
select throws_ok(
  $$ insert into public.event_team (event_id, user_id, role, added_by)
     values ('4d000000-0000-4000-8000-0000000000e2', '4d000000-0000-4000-8000-0000000000a1', 'captain', '4d000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'an organiser cannot add a team to someone else''s event');
select is((select count(*)::int from public.user_roles where user_id = '4d000000-0000-4000-8000-0000000000b1'), 1,
  'being an organiser grants no global role');

-- ---------------------------------------------------------------- organiser scope
select lives_ok($$ update public.events set description = 'Meet at gate 2' where id = '4d000000-0000-4000-8000-0000000000e1' $$,
  'an organiser edits their event');
select is((select count(*)::int from public.events where id = '4d000000-0000-4000-8000-0000000000e3'), 1,
  'an organiser sees their own draft');
update public.events set description = 'hijacked' where id = '4d000000-0000-4000-8000-0000000000e2';
reset role;
select isnt((select description from public.events where id = '4d000000-0000-4000-8000-0000000000e2'), 'hijacked',
  'an organiser cannot edit someone else''s event');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$ update public.events set created_by = '4d000000-0000-4000-8000-0000000000b1' where id = '4d000000-0000-4000-8000-0000000000e1' $$,
  '42501', null, 'an organiser cannot take over authorship');
select throws_ok(
  $$ insert into public.events (title, starts_at, ends_at, status, created_by)
     values ('New', now() + interval '1 day', now() + interval '1 day 1 hour', 'draft', '4d000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'organisers cannot create events (managers do)');
delete from public.events where id = '4d000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from public.events where id = '4d000000-0000-4000-8000-0000000000e1'), 1,
  'organisers cannot delete events');

select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b2');
update public.events set description = 'captain edit' where id = '4d000000-0000-4000-8000-0000000000e1';
select isnt((select description from public.events where id = '4d000000-0000-4000-8000-0000000000e1'), 'captain edit',
  'captains cannot edit the event');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a9');
select is((select count(*)::int from public.events where id = '4d000000-0000-4000-8000-0000000000e3'), 0,
  'other runners still cannot see drafts');
select is((select count(*)::int from public.event_team where event_id = '4d000000-0000-4000-8000-0000000000e1'), 0,
  'runners cannot read event team rows');
select is((select count(*)::int from public.event_team_members('4d000000-0000-4000-8000-0000000000e1')), 2,
  'runners see the names and roles of a published event''s team');

-- ---------------------------------------------------------------- waiting list (capacity 1)
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.event_rsvps (event_id, user_id, status) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a1', 'going') $$,
  'A takes the only place');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a2');
select throws_ok($$ insert into public.event_rsvps (event_id, user_id, status) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', 'going') $$,
  '23514', 'event is full', 'asking for a place on a full event still fails');
select lives_ok($$ insert into public.event_rsvps (event_id, user_id, status) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', 'waitlisted') $$,
  'B joins the waiting list');
select is(public.my_waitlist_position('4d000000-0000-4000-8000-0000000000e1'), 1, 'B is first on the waiting list');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a3');
select lives_ok($$ insert into public.event_rsvps (event_id, user_id, status) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a3', 'waitlisted') $$,
  'C joins the waiting list');
select is(public.my_waitlist_position('4d000000-0000-4000-8000-0000000000e1'), 2, 'C is second');
select throws_ok($$ update public.event_rsvps set status = 'going' where event_id = '4d000000-0000-4000-8000-0000000000e1' and user_id = '4d000000-0000-4000-8000-0000000000a3' $$,
  '23514', 'event is full', 'a waiting runner cannot skip the queue');

select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a1');
update public.event_rsvps set status = 'cancelled' where event_id = '4d000000-0000-4000-8000-0000000000e1' and user_id = '4d000000-0000-4000-8000-0000000000a1';
reset role;
select is(
  (select string_agg(user_id::text || ':' || status, ',' order by user_id) from public.event_rsvps where event_id = '4d000000-0000-4000-8000-0000000000e1'),
  '4d000000-0000-4000-8000-0000000000a1:cancelled,4d000000-0000-4000-8000-0000000000a2:going,4d000000-0000-4000-8000-0000000000a3:waitlisted',
  'a cancellation promotes the first runner on the waiting list');
select isnt((select promoted_at from public.event_rsvps where event_id = '4d000000-0000-4000-8000-0000000000e1' and user_id = '4d000000-0000-4000-8000-0000000000a2'), null,
  'the promotion is timestamped');
select is((select count(*)::int from private.rate_limit_events where user_id = '4d000000-0000-4000-8000-0000000000a2' and bucket = 'rsvp:burst'), 1,
  'a promotion does not count against anyone''s RSVP limit');

select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b1');
update public.events set capacity = 2 where id = '4d000000-0000-4000-8000-0000000000e1';
reset role;
select is((select status from public.event_rsvps where event_id = '4d000000-0000-4000-8000-0000000000e1' and user_id = '4d000000-0000-4000-8000-0000000000a3'), 'going',
  'raising the capacity promotes from the waiting list');

select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.event_rsvps (event_id, user_id, status) values ('4d000000-0000-4000-8000-0000000000e4', '4d000000-0000-4000-8000-0000000000a1', 'waitlisted') $$,
  'a waiting-list request on an event with space');
select is((select status from public.event_rsvps where event_id = '4d000000-0000-4000-8000-0000000000e4' and user_id = '4d000000-0000-4000-8000-0000000000a1'), 'going',
  'becomes a place straight away');
select is((select going::int || '/' || waitlisted::int from public.event_attendance(array['4d000000-0000-4000-8000-0000000000e1'::uuid])), '2/0',
  'attendance reports going and waiting counts');

-- ---------------------------------------------------------------- pace groups
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$ insert into public.event_pace_groups (id, event_id, label, min_pace_seconds, max_pace_seconds) values
       ('4d000000-0000-4000-8000-0000000000f1', '4d000000-0000-4000-8000-0000000000e1', '5:30–6:00', 330, 360) $$,
  'an organiser adds a pace group');
select throws_ok(
  $$ insert into public.event_pace_groups (event_id, label, min_pace_seconds, max_pace_seconds) values
       ('4d000000-0000-4000-8000-0000000000e1', 'backwards', 400, 300) $$,
  '23514', null, 'a pace range must run from faster to slower');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a2');
select lives_ok($$ update public.event_rsvps set pace_group_id = '4d000000-0000-4000-8000-0000000000f1'
                   where event_id = '4d000000-0000-4000-8000-0000000000e1' and user_id = '4d000000-0000-4000-8000-0000000000a2' $$,
  'a runner picks their pace group');
select throws_ok(
  $$ insert into public.event_pace_groups (event_id, label) values ('4d000000-0000-4000-8000-0000000000e1', 'mine') $$,
  '42501', null, 'runners cannot create pace groups');

-- ---------------------------------------------------------------- check-in
select throws_ok($$ update public.event_rsvps set checked_in_at = now() where user_id = '4d000000-0000-4000-8000-0000000000a2' $$,
  '42501', null, 'runners cannot check themselves in');
select throws_ok($$ select public.check_in_attendee('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', true) $$,
  '42501', null, 'runners cannot check others in');
select throws_ok($$ select * from public.event_roster('4d000000-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'runners cannot read the roster');
select is(private.can_staff_event('4d000000-0000-4000-8000-0000000000e1'), false,
  'event-team checks return false, never NULL, for someone with no team role');
select is(private.can_manage_event('4d000000-0000-4000-8000-0000000000e1'), false,
  'organiser checks return false, never NULL, for someone with no team role');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b2');
select lives_ok($$ select public.check_in_attendee('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', true) $$,
  'a captain checks a runner in');
select is((select count(*)::int from public.event_roster('4d000000-0000-4000-8000-0000000000e1') where checked_in_at is not null), 1,
  'the roster shows the check-in');
select throws_ok($$ select public.check_in_attendee('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a9', true) $$,
  'P0002', null, 'people without a place cannot be checked in');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000d1');
select throws_ok($$ select public.check_in_attendee('4d000000-0000-4000-8000-0000000000e4', '4d000000-0000-4000-8000-0000000000a1', true) $$,
  '22023', null, 'check-in is closed until two hours before the start');

-- ---------------------------------------------------------------- announcements and results
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000b1');
select lives_ok($$ insert into public.event_updates (event_id, author_id, body) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000b1', 'Bring water') $$,
  'an organiser posts an event update');
select lives_ok($$ insert into public.event_results (event_id, user_id, outcome, finish_seconds, recorded_by)
                   values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', 'finished', 1745, '4d000000-0000-4000-8000-0000000000b1') $$,
  'an organiser records a result');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a2');
select is((select finish_seconds from public.event_results where user_id = '4d000000-0000-4000-8000-0000000000a2'), 1745, 'a runner sees their own result');
select throws_ok($$ insert into public.event_updates (event_id, author_id, body) values ('4d000000-0000-4000-8000-0000000000e1', '4d000000-0000-4000-8000-0000000000a2', 'spam') $$,
  '42501', null, 'runners cannot post event updates');
select pg_temp.act_as('4d000000-0000-4000-8000-0000000000a9');
select is((select count(*)::int from public.event_results where event_id = '4d000000-0000-4000-8000-0000000000e1'), 0,
  'results are private to the runner and the event team');

reset role;
select is((select count(*)::int from public.audit_log where action = 'event_team.added' and target_id = '4d000000-0000-4000-8000-0000000000e1'), 2,
  'event team changes are audited');

select * from finish();
rollback;
