-- pgTAP: matching and squads (migration 20261124120000_matching_squads):
-- matching is opt-in and never exposes another runner's row; matches
-- exclude blocked, dismissed, undiscoverable and opted-out runners; squads
-- keep roster, chat, calendar and dashboard to active members; membership
-- changes follow captain rules and size limits; squad messages can be
-- reported and hidden.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('ae000000-0000-4000-8000-0000000000a1', 'sq.a@example.test', '{"display_name":"Sq Asha"}', 'authenticated', 'authenticated'),
  ('ae000000-0000-4000-8000-0000000000b1', 'sq.b@example.test', '{"display_name":"Sq Bilal"}', 'authenticated', 'authenticated'),
  ('ae000000-0000-4000-8000-0000000000c1', 'sq.c@example.test', '{"display_name":"Sq Chen"}', 'authenticated', 'authenticated'),
  ('ae000000-0000-4000-8000-0000000000d1', 'sq.d@example.test', '{"display_name":"Sq Dev"}', 'authenticated', 'authenticated'),
  ('ae000000-0000-4000-8000-0000000000e1', 'sq.m@example.test', '{"display_name":"Sq Mod"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('ae000000-0000-4000-8000-0000000000e1', 'programme_manager');
-- A, B, C and D opted in with similar preferences; D is blocked by A; C is not discoverable later.
insert into public.matching_profiles (user_id, opted_in, pace_min_s, pace_max_s, typical_km, areas, days, times, goals, experience)
select id, true, 330, 390, 6, '{gachibowli}', '{2,4,6}', '{early_morning}', '{consistency}', 'returning'
from auth.users where id in ('ae000000-0000-4000-8000-0000000000a1', 'ae000000-0000-4000-8000-0000000000b1',
                             'ae000000-0000-4000-8000-0000000000c1', 'ae000000-0000-4000-8000-0000000000d1');
insert into public.user_blocks (blocker_id, blocked_id) values ('ae000000-0000-4000-8000-0000000000a1', 'ae000000-0000-4000-8000-0000000000d1');

-- ---------------------------------------------------------------- matching
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.matching_profiles), 1::bigint, 'runners see only their own matching profile');
select is((select count(*) from public.find_running_matches() where user_id::text like 'ae000000-%'), 2::bigint, 'matches exclude blocked runners');
select ok((select 'Runs in the same area' = any (reasons) and 'Similar pace' = any (reasons) from public.find_running_matches() where user_id::text like 'ae000000-%' limit 1),
  'matches explain why');
select ok((select bool_and(shared_areas = '{gachibowli}') from public.find_running_matches() where user_id::text like 'ae000000-%'), 'only shared coarse areas are returned');
select lives_ok($$ insert into public.match_dismissals (other_id) values ('ae000000-0000-4000-8000-0000000000b1') $$, 'a runner dismisses a match');
select is((select count(*) from public.find_running_matches() where user_id::text like 'ae000000-%'), 1::bigint, 'dismissed runners disappear');
reset role;
update public.profiles set discoverable = false where id = 'ae000000-0000-4000-8000-0000000000c1';
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.find_running_matches() where user_id::text like 'ae000000-%'), 0::bigint, 'undiscoverable runners are not matched');
reset role;
update public.profiles set discoverable = true where id = 'ae000000-0000-4000-8000-0000000000c1';
update public.matching_profiles set opted_in = false where user_id = 'ae000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.find_running_matches() where user_id::text like 'ae000000-%'), 0::bigint, 'opted-out runners get no matches');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000c1');
select ok(not exists (select 1 from public.find_running_matches() where user_id = 'ae000000-0000-4000-8000-0000000000a1'),
  'and are not offered to others');

-- ---------------------------------------------------------------- squads
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
create temp table sq as select public.create_squad('Dawn Patrol', 'Early runs', 20, 'request', 3) as id;
grant select on sq to authenticated;
select is((select role || ':' || status from public.squad_members where squad_id = (select id from sq)), 'captain:active',
  'the creator is captain');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000b1', 'invite') $$,
  'the captain invites B');
select throws_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000d1', 'invite') $$,
  '42501', null, 'blocked runners cannot be invited');

select pg_temp.act_as('ae000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.squads where id = (select id from sq)), 1::bigint, 'the invitee can see the squad');
select throws_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000c1', 'invite') $$,
  '42501', null, 'members who are not captain cannot invite');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000b1', 'accept') $$,
  'B accepts');

select pg_temp.act_as('ae000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.squad_members where squad_id = (select id from sq)), 0::bigint,
  'outsiders cannot see the roster');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000c1', 'request') $$,
  'C asks to join an open squad');
select throws_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000c1', 'approve') $$,
  '42501', null, 'C cannot approve themselves');
select throws_ok($$ select public.squad_dashboard((select id from sq)) $$, '42501', null, 'non-members get no dashboard');

select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000c1', 'approve') $$,
  'the captain approves');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000e1', 'invite') $$,
  'invites are allowed while full');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000e1');
select throws_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000e1', 'accept') $$,
  '22023', null, 'but nobody joins a full squad');

-- Chat, reports and moderation.
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000b1');
create temp table msg (id uuid);
grant all on msg to authenticated;
with x as (insert into public.squad_messages (squad_id, body) values ((select id from sq), 'Saturday 6am?') returning id)
insert into msg select id from x;
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000e1');
select is((select count(*) from public.squad_messages), 0::bigint, 'non-members cannot read the chat');
select throws_ok($$ insert into public.squad_messages (squad_id, body) values ((select id from sq), 'hi') $$, '42501', null,
  'or post in it');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.squad_messages), 1::bigint, 'members read the chat');
select lives_ok($$ select public.report_content('squad_message', (select id from msg), 'spam', null) $$, 'a member reports a message');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000e1');
select lives_ok($$ select public.resolve_report((select id from public.content_reports where target_id = (select id from msg)), 'hide_content', 'spam') $$,
  'a moderator hides it');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.squad_messages), 0::bigint, 'hidden messages disappear for members');

-- Calendar and attendance.
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.squad_runs (squad_id, title, starts_at, meeting_point) values
  ((select id from sq), 'Lake loop', now() + interval '2 days', 'Gachibowli stadium gate') $$, 'a member adds a squad run');
select throws_ok($$ insert into public.squad_run_attendance (run_id, status) values ((select id from public.squad_runs), 'attended') $$,
  '22023', null, 'attendance waits for the run to start');
select is(jsonb_array_length(public.squad_dashboard((select id from sq))->'members'), 3, 'the dashboard lists active members');
select is((select count(*) from public.squad_people((select id from sq)) where display_name is not null), 4::bigint,
  'members see everyone''s names, including the pending invite');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.squad_people((select id from sq))), 0::bigint, 'outsiders get no names');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000a1');

-- Captaincy and leaving.
select throws_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000a1', 'leave') $$,
  '22023', null, 'the only captain must hand over first');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000b1', 'make_captain') $$,
  'the captain appoints B');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000a1', 'leave') $$, 'then leaves');
select pg_temp.act_as('ae000000-0000-4000-8000-0000000000b1');
select lives_ok($$ select public.squad_membership((select id from sq), 'ae000000-0000-4000-8000-0000000000c1', 'remove') $$,
  'a captain removes a member');
reset role;
select is((select count(*) from public.audit_log where action = 'squad.member_removed' and subject_id = 'ae000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'removal is audited');

select * from finish();
rollback;
