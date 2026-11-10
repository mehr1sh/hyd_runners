-- pgTAP: coach access needs a current staff role AND an assignment; private
-- messages are readable only by their two participants (migration
-- 20261109120000_coach_and_message_access).
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

-- Act as a signed-in user, or as an anonymous visitor.
create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.act_as_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- R1, R2: runners. C: assigned coach. U: unassigned coach. X: coach who will
-- be revoked. Y: coach + mentor who loses only the coach role. Z: coach whose
-- role disappears without the cleanup trigger (a stale assignment).
-- M: programme manager. A: admin.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('1a000000-0000-4000-8000-0000000000a1', 'cma.r1@example.test', '{"display_name":"CMA Runner 1"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000a2', 'cma.r2@example.test', '{"display_name":"CMA Runner 2"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000c1', 'cma.c@example.test', '{"display_name":"CMA Coach C"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000c2', 'cma.u@example.test', '{"display_name":"CMA Coach U"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000c3', 'cma.x@example.test', '{"display_name":"CMA Coach X"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000c4', 'cma.y@example.test', '{"display_name":"CMA Coach Y"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000c5', 'cma.z@example.test', '{"display_name":"CMA Coach Z"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000d1', 'cma.m@example.test', '{"display_name":"CMA Manager M"}', 'authenticated', 'authenticated'),
  ('1a000000-0000-4000-8000-0000000000e1', 'cma.a@example.test', '{"display_name":"CMA Admin A"}', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('1a000000-0000-4000-8000-0000000000c1', 'coach'),
  ('1a000000-0000-4000-8000-0000000000c2', 'coach'),
  ('1a000000-0000-4000-8000-0000000000c3', 'coach'),
  ('1a000000-0000-4000-8000-0000000000c4', 'coach'),
  ('1a000000-0000-4000-8000-0000000000c4', 'mentor'),
  ('1a000000-0000-4000-8000-0000000000c5', 'coach'),
  ('1a000000-0000-4000-8000-0000000000d1', 'programme_manager'),
  ('1a000000-0000-4000-8000-0000000000e1', 'admin');

insert into public.coach_assignments (coach_id, runner_id) values
  ('1a000000-0000-4000-8000-0000000000c1', '1a000000-0000-4000-8000-0000000000a1'),
  ('1a000000-0000-4000-8000-0000000000c3', '1a000000-0000-4000-8000-0000000000a1'),
  ('1a000000-0000-4000-8000-0000000000c4', '1a000000-0000-4000-8000-0000000000a1'),
  ('1a000000-0000-4000-8000-0000000000c5', '1a000000-0000-4000-8000-0000000000a2');

insert into public.user_preferences (user_id, goal, sessions_per_week, max_session_minutes) values
  ('1a000000-0000-4000-8000-0000000000a1', 'build_habit', 3, 30),
  ('1a000000-0000-4000-8000-0000000000a2', 'build_habit', 3, 30);

insert into public.feedback (id, user_id, target, body, barrier, assigned_to) values
  ('1a000000-0000-4000-8000-0000000000f1', '1a000000-0000-4000-8000-0000000000a1', 'app', 'For X', 'other', '1a000000-0000-4000-8000-0000000000c3'),
  ('1a000000-0000-4000-8000-0000000000f2', '1a000000-0000-4000-8000-0000000000a1', 'app', 'For C', 'other', '1a000000-0000-4000-8000-0000000000c1'),
  ('1a000000-0000-4000-8000-0000000000f3', '1a000000-0000-4000-8000-0000000000a2', 'app', 'For Z', 'other', '1a000000-0000-4000-8000-0000000000c5');
insert into public.feedback_replies (feedback_id, author_id, body) values
  ('1a000000-0000-4000-8000-0000000000f1', '1a000000-0000-4000-8000-0000000000c3', 'X replied'),
  ('1a000000-0000-4000-8000-0000000000f2', '1a000000-0000-4000-8000-0000000000c1', 'C replied');

insert into public.messages (sender_id, recipient_id, body) values
  ('1a000000-0000-4000-8000-0000000000c3', '1a000000-0000-4000-8000-0000000000a1', 'X to R1'),
  ('1a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000c3', 'R1 to X'),
  ('1a000000-0000-4000-8000-0000000000c1', '1a000000-0000-4000-8000-0000000000a1', 'C to R1');

create temp view fixture_messages with (security_invoker = true) as
  select * from public.messages where sender_id::text like '1a000000-%' and recipient_id::text like '1a000000-%';
grant select on fixture_messages to authenticated, anon;

-- ---------------------------------------------------------------- before revocation
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c3');
select is((select count(*)::int from public.profiles where id = '1a000000-0000-4000-8000-0000000000a1'), 1,
  'coach X reads their assigned runner before revocation');
select is((select count(*)::int from public.feedback where id = '1a000000-0000-4000-8000-0000000000f1'), 1,
  'coach X reads feedback assigned to them before revocation');

-- ---------------------------------------------------------------- manager revokes X (through RLS)
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ delete from public.user_roles where user_id = '1a000000-0000-4000-8000-0000000000c3' and role = 'coach' $$,
  'a manager revokes coach X');
select lives_ok(
  $$ delete from public.user_roles where user_id = '1a000000-0000-4000-8000-0000000000c4' and role = 'coach' $$,
  'a manager revokes only the coach role from Y, who stays a mentor');
reset role;

select is((select count(*)::int from public.coach_assignments where coach_id = '1a000000-0000-4000-8000-0000000000c3'), 0,
  'revocation removes the coach''s assignments');
select is((select count(*)::int from public.coach_assignments where coach_id = '1a000000-0000-4000-8000-0000000000c4'), 1,
  'a staff member who still holds another staff role keeps their assignments');
select is((select assigned_to from public.feedback where id = '1a000000-0000-4000-8000-0000000000f1'), null,
  'feedback assigned to the revoked coach returns to the unassigned queue');
select is((select status from public.feedback where id = '1a000000-0000-4000-8000-0000000000f1'), 'acknowledged'::public.feedback_status,
  'the returned feedback keeps its status');
select is((select count(*)::int from public.feedback_replies where feedback_id = '1a000000-0000-4000-8000-0000000000f1'), 1,
  'the revoked coach''s replies are kept');
select is((select count(*)::int from fixture_messages), 3, 'no messages are deleted by revocation');

-- ---------------------------------------------------------------- revoked coach X
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c3');
select is((select count(*)::int from public.profiles where id::text like '1a000000-%'), 1, 'revoked coach reads only their own profile');
select is((select count(*)::int from public.user_preferences where user_id::text like '1a000000-%'), 0, 'revoked coach reads no runner preferences');
select is((select count(*)::int from public.feedback where id::text like '1a000000-%'), 0, 'revoked coach reads no feedback');
select is((select count(*)::int from public.feedback_replies where feedback_id::text like '1a000000-%'), 0, 'revoked coach reads no feedback replies');
select is((select count(*)::int from public.coach_assignments where coach_id = '1a000000-0000-4000-8000-0000000000c3'), 0, 'revoked coach has no assignments');
select throws_ok(
  $$ insert into public.feedback_replies (feedback_id, author_id, body)
     values ('1a000000-0000-4000-8000-0000000000f1', '1a000000-0000-4000-8000-0000000000c3', 'still here') $$,
  '42501', null, 'revoked coach cannot reply to feedback');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000c3', '1a000000-0000-4000-8000-0000000000a1', 'hello again') $$,
  '42501', null, 'revoked coach cannot message their former runner');
select is((select count(*)::int from public.list_message_recipients() where id::text like '1a000000-%'), 0,
  'revoked coach has nobody to message');
select is((select count(*)::int from fixture_messages), 2,
  'revoked coach still reads their own conversation history');

-- ---------------------------------------------------------------- re-granting does not restore stale access
reset role;
insert into public.user_roles (user_id, role) values ('1a000000-0000-4000-8000-0000000000c3', 'coach');
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c3');
select is((select count(*)::int from public.profiles where id = '1a000000-0000-4000-8000-0000000000a1'), 0,
  're-granting the coach role does not restore former assignments');
reset role;
delete from public.user_roles where user_id = '1a000000-0000-4000-8000-0000000000c3' and role = 'coach';

select pg_temp.act_as('1a000000-0000-4000-8000-0000000000d1');
select throws_ok(
  $$ insert into public.coach_assignments (coach_id, runner_id, assigned_by)
     values ('1a000000-0000-4000-8000-0000000000c3', '1a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000d1') $$,
  '42501', null, 'a revoked coach cannot be assigned again');

-- ---------------------------------------------------------------- stale assignment without the cleanup trigger
-- Defence in depth: even if an assignment outlives the role, policies deny it.
reset role;
alter table public.user_roles disable trigger user_roles_cleanup_after_revoke;
delete from public.user_roles where user_id = '1a000000-0000-4000-8000-0000000000c5' and role = 'coach';
alter table public.user_roles enable trigger user_roles_cleanup_after_revoke;
select is((select count(*)::int from public.coach_assignments where coach_id = '1a000000-0000-4000-8000-0000000000c5'), 1,
  'setup: Z keeps a stale assignment');

select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c5');
select is((select count(*)::int from public.profiles where id = '1a000000-0000-4000-8000-0000000000a2'), 0, 'stale assignment: no runner profile');
select is((select count(*)::int from public.user_preferences where user_id = '1a000000-0000-4000-8000-0000000000a2'), 0, 'stale assignment: no runner preferences');
select is((select count(*)::int from public.feedback where id = '1a000000-0000-4000-8000-0000000000f3'), 0, 'stale feedback assignment: feedback hidden');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000c5', '1a000000-0000-4000-8000-0000000000a2', 'stale') $$,
  '42501', null, 'stale assignment: cannot message the runner');
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-0000000000c5', 'stale') $$,
  '42501', null, 'stale assignment: the runner cannot message the former coach');

-- ---------------------------------------------------------------- runner R1
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000c3', 'are you there') $$,
  '42501', null, 'runner cannot message a revoked coach');
select is(
  (select array_agg(distinct id order by id)::text from public.list_message_recipients() where id::text like '1a000000-%'),
  '{1a000000-0000-4000-8000-0000000000c1,1a000000-0000-4000-8000-0000000000c4}',
  'runner can message only their active coach and mentor');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000c1', 'R1 to C') $$,
  'runner can message their assigned coach');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000d1', 'hello') $$,
  '42501', null, 'runner cannot start a conversation with a manager');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000c1', '1a000000-0000-4000-8000-0000000000a1', 'spoofed') $$,
  '42501', null, 'runner cannot send a message as someone else');
select is((select count(*)::int from fixture_messages), 4, 'runner reads every message they sent or received');
select is((select count(*)::int from public.profiles where id::text like '1a000000-%'), 1, 'runner reads only their own profile');

-- ---------------------------------------------------------------- unassigned coach U
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c2');
select is((select count(*)::int from public.profiles where id::text like '1a000000-%'), 1, 'unassigned coach reads only their own profile');
select is((select count(*)::int from public.user_preferences where user_id::text like '1a000000-%'), 0, 'unassigned coach reads no preferences');
select is((select count(*)::int from public.feedback where id::text like '1a000000-%'), 0, 'unassigned coach reads no feedback');
select is((select count(*)::int from fixture_messages), 0, 'unassigned coach reads no messages');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000c2', '1a000000-0000-4000-8000-0000000000a1', 'hi') $$,
  '42501', null, 'unassigned coach cannot message a runner');

-- ---------------------------------------------------------------- assigned coach C
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000c1');
select is(
  (select array_agg(id order by id)::text from public.profiles where id::text like '1a000000-%'),
  '{1a000000-0000-4000-8000-0000000000a1,1a000000-0000-4000-8000-0000000000c1}',
  'assigned coach reads their runner''s profile and their own');
select is((select array_agg(user_id)::text from public.user_preferences where user_id::text like '1a000000-%'),
  '{1a000000-0000-4000-8000-0000000000a1}', 'assigned coach reads only their runner''s preferences');
select is((select array_agg(id)::text from public.feedback where id::text like '1a000000-%'),
  '{1a000000-0000-4000-8000-0000000000f2}', 'assigned coach reads only feedback assigned to them');
select is((select count(*)::int from public.feedback_replies where feedback_id::text like '1a000000-%'), 1,
  'assigned coach reads replies on their feedback only');
select is((select count(*)::int from fixture_messages), 2,
  'assigned coach reads only their own conversation, not the runner''s other ones');

-- ---------------------------------------------------------------- runner R2: non-participant
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from fixture_messages), 0, 'a non-participant reads no messages');
select throws_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-0000000000a1', 'hi') $$,
  '42501', null, 'a runner cannot message another runner');

-- ---------------------------------------------------------------- manager M
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000d1');
select is((select count(*)::int from fixture_messages), 0, 'a manager cannot read other people''s conversations');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000d1', '1a000000-0000-4000-8000-0000000000a2', 'M to R2') $$,
  'a manager can message any runner');
select is((select count(*)::int from fixture_messages), 1, 'a manager reads their own conversation');
select is((select count(*)::int from public.feedback where id::text like '1a000000-%'), 3, 'a manager still reads all feedback');

-- ---------------------------------------------------------------- admin A
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000e1');
select is((select count(*)::int from fixture_messages), 0, 'an admin cannot read other people''s conversations');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000e1', '1a000000-0000-4000-8000-0000000000a1', 'A to R1') $$,
  'an admin can message any runner');

-- ---------------------------------------------------------------- R2 may reply to the manager who wrote
select pg_temp.act_as('1a000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$ insert into public.messages (sender_id, recipient_id, body)
     values ('1a000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-0000000000d1', 'R2 to M') $$,
  'a runner can reply to a manager who wrote to them');

-- ---------------------------------------------------------------- alternate paths
select throws_ok($$ update public.messages set body = 'edited' $$, '42501', null, 'messages cannot be edited');
select throws_ok($$ delete from public.messages $$, '42501', null, 'messages cannot be deleted');
select pg_temp.act_as_anon();
select throws_ok($$ select count(*) from public.messages $$, '42501', null, 'signed-out visitors cannot query messages');
reset role;
select is(
  (select array_agg(p.proname order by p.proname)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef),
  '{appoint_club_admin,captains_network,challenge_leaderboard,check_in_attendee,check_in_by_token,club_leaderboard,club_roster,club_stats,coach_propose_changes,coach_runner_list,coach_runner_overview,consume_rate_limit,create_squad,end_live_session,event_attendance,event_roster,event_team_members,finalize_activity_import,find_running_matches,group_run_recap,join_club_with_invite,join_league_team,league_standings,league_team_codes,list_message_recipients,moderation_report_content,my_bookings,my_challenge_progress,my_waitlist_position,mystery_route,professional_directory,purge_stale_live_positions,race_partners,report_content,request_booking,request_live_help,request_professional_verification,resolve_live_help,resolve_report,review_professional,route_review_comments,route_review_summary,runner_profile,schedule_series_runs,search_runners,series_history,set_challenge_cause,set_mystery_run,settle_challenges_for,settle_my_challenges,squad_dashboard,squad_membership,squad_people,squad_relay_progress,start_live_session,start_location_sharing,stop_location_sharing,update_booking,update_live_position,verify_challenge_cause,weekly_leaderboard}',
  'no new SECURITY DEFINER function in public can bypass message RLS without review');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name in ('can_message', 'is_active_coach', 'holds_assignee_role')
      and grantee = 'anon'),
  0, 'signed-out visitors cannot call the access helpers');
select is(
  (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'messages: participants read'),
  '((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid)))',
  'the only message read policy is participants-only');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.messages'::regclass and polcmd in ('r', '*')), 1,
  'messages have exactly one read policy');

select * from finish();
rollback;
