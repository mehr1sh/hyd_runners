-- pgTAP tests for the identity + community migration. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Four users: two runners, one coach, one manager.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'runner.a@example.test', '{"display_name":"Runner A"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'runner.b@example.test', '{"display_name":"Runner B"}', 'authenticated', 'authenticated'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'coach.c@example.test', '{"display_name":"Coach C"}', 'authenticated', 'authenticated'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'manager.m@example.test', '{"display_name":"Manager M"}', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'coach'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'programme_manager');

insert into public.locations (id, name, latitude, longitude)
values ('99999999-9999-4999-8999-999999999999', 'Test Ground', 17.385000, 78.486700);

-- Seed rows created as superuser so RLS does not interfere with setup.
insert into public.feedback (user_id, target, body, barrier)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'app', 'Runner B note', 'other');

insert into public.user_preferences (user_id, goal, sessions_per_week, max_session_minutes)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'build_habit', 3, 30);

insert into public.announcements (id, author_id, audience, title, body, publish_at)
values
  ('e0000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'everyone', 'Welcome', 'Published for everyone', now() - interval '1 hour'),
  ('e0000000-0000-4000-8000-000000000002', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'everyone', 'Future note', 'Scheduled later', now() + interval '1 day'),
  ('e0000000-0000-4000-8000-000000000003', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'programme', 'Staff brief', 'Programme staff only', now() - interval '1 hour');

insert into public.location_updates (id, location_id, author_id, title, body, publish_at)
values
  ('e0000000-0000-4000-8000-000000000011', '99999999-9999-4999-8999-999999999999', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Gate open', 'Published notice', now() - interval '1 hour'),
  ('e0000000-0000-4000-8000-000000000012', '99999999-9999-4999-8999-999999999999', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Path works', 'Scheduled notice', now() + interval '1 day');

select is(
  (select count(*)::int
     from pg_class
    where relnamespace = 'public'::regnamespace
      and relrowsecurity
      and relname in ('user_preferences', 'coach_assignments', 'feedback', 'feedback_replies',
                      'announcements', 'announcement_reads', 'location_updates', 'messages')),
  8,
  'RLS enabled on identity and community tables'
);

-- ---------------------------------------------------------------------------
-- Runner A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.feedback (user_id, target, body, barrier)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'app', 'Hard to stay consistent', 'consistency') $$,
  'runner can submit their own feedback'
);

select throws_ok(
  $$ insert into public.feedback (user_id, target, body, barrier)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'app', 'spoofed', 'other') $$,
  '42501', null, 'runner cannot submit feedback as someone else'
);

select throws_ok(
  $$ insert into public.feedback (user_id, target, body, barrier, assigned_to)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'app', 'preassigned', 'other', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'runner cannot pre-assign their own feedback'
);

select is(
  (select count(*)::int from public.feedback),
  1,
  'runner sees only their own feedback'
);

update public.feedback set status = 'resolved' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.feedback set status = 'resolved' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select status from public.feedback where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'new'::public.feedback_status,
  'runner cannot change feedback status'
);

select lives_ok(
  $$ insert into public.user_preferences (user_id, goal, sessions_per_week, max_session_minutes, preferred_days, preferred_times_of_day)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'first_5k', 4, 45, array[1,3,5]::smallint[], array['morning']::public.time_of_day[]) $$,
  'runner can save their own preferences'
);

select is(
  (select count(*)::int from public.user_preferences),
  1,
  'runner sees only their own preferences'
);

update public.user_preferences
   set goal = 'build_habit'
 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select goal from public.user_preferences where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'build_habit'::public.fitness_goal,
  'runner can update their own preferences'
);

-- user_id has no UPDATE grant, which is also why the app avoids PostgREST upserts here.
select throws_ok(
  $$ update public.user_preferences
        set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'runner cannot move preferences to another user'
);

select throws_ok(
  $$ insert into public.announcements (author_id, audience, title, body)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'everyone', 'nope', 'nope') $$,
  '42501', null, 'runner cannot create announcements'
);

select is(
  (select count(*)::int from public.announcements where author_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  1,
  'runner sees only published everyone-announcements'
);

select lives_ok(
  $$ insert into public.announcement_reads (user_id, announcement_id)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000001') $$,
  'runner can mark a visible announcement read'
);

select throws_ok(
  $$ insert into public.announcement_reads (user_id, announcement_id)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'runner cannot mark a read for another user'
);

select throws_ok(
  $$ insert into public.location_updates (location_id, author_id, title, body)
     values ('99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nope', 'nope') $$,
  '42501', null, 'runner cannot create location updates'
);

select is(
  (select count(*)::int from public.location_updates where location_id = '99999999-9999-4999-8999-999999999999'),
  1,
  'runner sees only published location updates'
);

select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'hi') $$,
  '42501', null, 'runner cannot message an unrelated runner'
);

-- Runners reach managers through Feedback until a manager writes to them.
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'hello manager') $$,
  '42501', null, 'runner cannot start a conversation with a manager'
);

select is(
  (select count(*)::int from public.messages),
  0,
  'runner has no messages yet'
);

select throws_ok(
  $$ insert into public.coach_assignments (coach_id, runner_id, assigned_by)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'runner cannot create coach assignments'
);

select is(
  (select count(*)::int from public.coach_assignments),
  0,
  'runner sees no coach assignments yet'
);

-- ---------------------------------------------------------------------------
-- Coach C: unassigned, then assigned to Runner A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.feedback),
  0,
  'coach cannot read unassigned feedback'
);

select is(
  (select count(*)::int from public.coach_assignments),
  0,
  'coach sees no assignments before any exist'
);

reset role;
insert into public.coach_assignments (coach_id, runner_id, assigned_by)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.coach_assignments),
  1,
  'coach can read their own assignment'
);

select is(
  (select count(*)::int from public.profiles),
  2,
  'coach reads their own profile and their assigned runner'
);

select is(
  (select array_agg(user_id)::text from public.user_preferences),
  '{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}',
  'coach reads only assigned runner preferences'
);

delete from public.coach_assignments;
select is(
  (select count(*)::int from public.coach_assignments),
  1,
  'coach cannot remove assignments'
);

select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'welcome aboard') $$,
  'coach can message an assigned runner'
);

reset role;
update public.feedback
   set assigned_to = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.feedback),
  1,
  'assigned coach can read the assigned feedback'
);

select lives_ok(
  $$ insert into public.feedback_replies (feedback_id, author_id, body)
     select id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Working on it'
       from public.feedback
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'assigned coach can reply to feedback'
);

select is(
  (select status from public.feedback where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'acknowledged'::public.feedback_status,
  'staff reply acknowledges new feedback'
);

update public.feedback set status = 'resolved' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select status from public.feedback where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'acknowledged'::public.feedback_status,
  'coach cannot change feedback status directly'
);

select is(
  (select count(*)::int from public.announcements where author_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  2,
  'staff see published and programme announcements but not scheduled ones'
);

select lives_ok(
  $$ insert into public.announcement_reads (user_id, announcement_id)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'e0000000-0000-4000-8000-000000000003') $$,
  'staff can mark a staff announcement read'
);

-- ---------------------------------------------------------------------------
-- Runner B: isolation from Runner A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.feedback),
  1,
  'runner B sees only their own feedback'
);

select is(
  (select count(*)::int from public.feedback_replies),
  0,
  'runner B cannot read replies on another runner feedback'
);

select is(
  (select count(*)::int from public.messages),
  0,
  'runner B cannot read other conversations'
);

-- ---------------------------------------------------------------------------
-- Manager M
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.announcements (author_id, audience, title, body)
     values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'everyone', 'Route change', 'Meet at the gate') $$,
  'manager can create announcements'
);

select is(
  (select count(*)::int from public.announcements where author_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  4,
  'managers see every announcement including scheduled ones'
);

select is(
  (select count(*)::int
     from public.feedback
    where user_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  2,
  'managers see all feedback'
);

update public.feedback
   set status = 'acknowledged', assigned_to = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is(
  (select status from public.feedback where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'acknowledged'::public.feedback_status,
  'manager can assign and update feedback'
);

select lives_ok(
  $$ insert into public.coach_assignments (coach_id, runner_id, assigned_by)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') $$,
  'manager can create coach assignments'
);

select is(
  (select count(*)::int from public.location_updates where location_id = '99999999-9999-4999-8999-999999999999'),
  2,
  'managers see scheduled location updates too'
);

select lives_ok(
  $$ insert into public.location_updates (location_id, author_id, title, body)
     values ('99999999-9999-4999-8999-999999999999', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Notice', 'From a manager') $$,
  'manager can create location updates'
);

select is(
  (select count(*)::int from public.messages where recipient_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
  0,
  'managers cannot read other people''s conversations'
);

insert into public.messages (sender_id, recipient_id, body)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'checking in');

delete from public.coach_assignments where runner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is(
  (select count(*)::int from public.coach_assignments where coach_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  1,
  'manager can remove a coach assignment'
);

-- ---------------------------------------------------------------------------
-- Assignment guards run as superuser
-- ---------------------------------------------------------------------------
reset role;

select throws_ok(
  $$ insert into public.coach_assignments (coach_id, runner_id, assigned_by)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') $$,
  '42501', null, 'assignment requires a staff coach'
);

select throws_ok(
  $$ update public.feedback
        set assigned_to = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'feedback can only be assigned to staff'
);

-- ---------------------------------------------------------------------------
-- Message recipient list
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

-- Scoped to fixture users so managers left by local e2e runs do not change the count.
select is(
  (select array_agg(distinct id order by id)::text
     from public.list_message_recipients()
    where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
  '{cccccccc-cccc-4ccc-8ccc-cccccccccccc,dddddddd-dddd-4ddd-8ddd-dddddddddddd}',
  'runner can message only their coach and a manager who wrote to them'
);

select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'thanks') $$,
  'runner can reply to a manager who wrote to them'
);

reset role;
select * from finish();
rollback;
