-- pgTAP: clubs (migration 20261111120000_clubs): creation, club-scoped
-- roles, joining (open, request, invite), leadership rules, announcements,
-- club events, roster, stats and the members-only leaderboard.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- M manager; A club admin; K captain; R runner members; P pending; X outsider.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('5e000000-0000-4000-8000-0000000000d1', 'cl.m@example.test', '{"display_name":"Cl Manager"}', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a1', 'cl.a@example.test', '{"display_name":"Cl Admin"}', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a2', 'cl.k@example.test', '{"display_name":"Cl Captain"}', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a3', 'cl.r@example.test', '{"display_name":"Cl Runner"}', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a4', 'cl.p@example.test', '{"display_name":"Cl Pending"}', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a9', 'cl.x@example.test', '{"display_name":"Cl Outsider"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('5e000000-0000-4000-8000-0000000000d1', 'programme_manager');

-- ---------------------------------------------------------------- creation
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$ insert into public.clubs (slug, name, created_by) values ('rogue-club', 'Rogue', '5e000000-0000-4000-8000-0000000000a3') $$,
  '42501', null, 'runners cannot create clubs');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ insert into public.clubs (id, slug, name, join_policy, created_by) values
       ('5e000000-0000-4000-8000-0000000000c1', 'kbr-dawn-runners', 'KBR Dawn Runners', 'request', '5e000000-0000-4000-8000-0000000000d1'),
       ('5e000000-0000-4000-8000-0000000000c2', 'open-joggers', 'Open Joggers', 'open', '5e000000-0000-4000-8000-0000000000d1'),
       ('5e000000-0000-4000-8000-0000000000c3', 'secret-squad', 'Secret Squad', 'invite', '5e000000-0000-4000-8000-0000000000d1') $$,
  'a manager creates clubs');
select throws_ok($$ insert into public.clubs (slug, name, created_by) values ('Bad Slug!', 'Bad', '5e000000-0000-4000-8000-0000000000d1') $$,
  '23514', null, 'slugs must be lowercase words joined by hyphens');
select lives_ok($$ select public.appoint_club_admin('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a1') $$,
  'a manager appoints the first club admin');
select lives_ok($$ select public.appoint_club_admin('5e000000-0000-4000-8000-0000000000c3', '5e000000-0000-4000-8000-0000000000a1') $$,
  'and for the invite-only club');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select public.appoint_club_admin('5e000000-0000-4000-8000-0000000000c2', '5e000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'club admins cannot appoint admins of other clubs through the manager function');
select is((select count(*)::int from public.user_roles where user_id = '5e000000-0000-4000-8000-0000000000a1'), 1,
  'a club admin has no global staff role');

-- ---------------------------------------------------------------- joining
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a3');
select lives_ok($$ insert into public.club_members (club_id, user_id) values ('5e000000-0000-4000-8000-0000000000c2', '5e000000-0000-4000-8000-0000000000a3') $$,
  'a runner joins an open club');
select is((select status from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c2' and user_id = '5e000000-0000-4000-8000-0000000000a3'), 'active',
  'open clubs admit straight away');
select throws_ok($$ insert into public.club_members (club_id, user_id) values ('5e000000-0000-4000-8000-0000000000c3', '5e000000-0000-4000-8000-0000000000a3') $$,
  '42501', 'This club is invite-only', 'invite-only clubs cannot be joined directly');
select throws_ok($$ insert into public.club_members (club_id, user_id) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a9') $$,
  '42501', null, 'nobody can add someone else');
select lives_ok($$ insert into public.club_members (club_id, user_id) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a3') $$,
  'a runner asks to join a request club');
select is((select role || ':' || status from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a3'), 'member:pending',
  'the request is pending, as a plain member');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a4');
select throws_ok($$ insert into public.club_members (club_id, user_id, role, status) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a4', 'admin', 'active') $$,
  '42501', null, 'a request cannot claim a role or status');
select lives_ok($$ insert into public.club_members (club_id, user_id) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a4') $$,
  'the same runner asks to join normally');
select is((select count(*)::int from public.club_announcements), 0, 'pending requesters cannot read announcements');
update public.club_members set status = 'active' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a4';
reset role;
select is((select status from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a4'), 'pending',
  'requesters cannot approve themselves');

-- ---------------------------------------------------------------- leadership
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
select lives_ok($$ update public.club_members set status = 'active' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a3' $$,
  'the club admin approves a request');
select is((select decided_by::text from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a3'),
  '5e000000-0000-4000-8000-0000000000a1', 'the approver is recorded');
reset role;
-- K joins via the open path is impossible (request club); seed K as an active member.
insert into public.club_members (club_id, user_id, role, status, joined_at) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a2', 'member', 'active', now());
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
select lives_ok($$ update public.club_members set role = 'captain' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a2' $$,
  'the club admin makes a captain');
select throws_ok($$ update public.club_members set role = 'member' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a1' $$,
  '23514', 'A club needs at least one admin', 'the last admin cannot step down');
select throws_ok($$ delete from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a1' $$,
  '23514', 'A club needs at least one admin', 'the last admin cannot leave');

select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a2');
select throws_ok($$ update public.club_members set role = 'admin' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a2' $$,
  '42501', 'Only club admins change roles', 'captains cannot promote themselves');
select lives_ok($$ update public.club_members set status = 'active' where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a4' $$,
  'captains approve requests');
select throws_ok($$ delete from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1' and user_id = '5e000000-0000-4000-8000-0000000000a1' $$,
  '42501', 'Only club admins remove admins', 'captains cannot remove admins');
update public.clubs set name = 'Captain renamed' where id = '5e000000-0000-4000-8000-0000000000c1';
reset role;
select is((select name from public.clubs where id = '5e000000-0000-4000-8000-0000000000c1'), 'KBR Dawn Runners', 'captains cannot edit club details');

select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
update public.clubs set name = 'Other renamed' where id = '5e000000-0000-4000-8000-0000000000c2';
reset role;
select is((select name from public.clubs where id = '5e000000-0000-4000-8000-0000000000c2'), 'Open Joggers', 'club admins cannot edit other clubs');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
select lives_ok($$ update public.clubs set description = 'Dawn runs around KBR Park' where id = '5e000000-0000-4000-8000-0000000000c1' $$,
  'club admins edit their own club');

-- ---------------------------------------------------------------- announcements and events
select lives_ok($$ insert into public.club_announcements (club_id, author_id, title, body) values
                   ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a1', 'Sunday long run', 'Meet at 5:45') $$,
  'club admins post announcements');
select lives_ok(
  $$ insert into public.events (id, title, starts_at, ends_at, status, created_by, club_id) values
       ('5e000000-0000-4000-8000-0000000000e1', 'KBR loop', now() + interval '1 day', now() + interval '1 day 1 hour', 'published',
        '5e000000-0000-4000-8000-0000000000a1', '5e000000-0000-4000-8000-0000000000c1') $$,
  'club admins create events for their club');
select throws_ok(
  $$ insert into public.events (title, starts_at, ends_at, status, created_by, club_id) values
       ('Hijack', now() + interval '1 day', now() + interval '1 day 1 hour', 'published',
        '5e000000-0000-4000-8000-0000000000a1', '5e000000-0000-4000-8000-0000000000c2') $$,
  '42501', null, 'but not for other clubs');
select throws_ok(
  $$ insert into public.events (title, starts_at, ends_at, status, created_by) values
       ('No club', now() + interval '1 day', now() + interval '1 day 1 hour', 'published', '5e000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'and not events outside a club');
select lives_ok($$ update public.events set description = 'Two laps' where id = '5e000000-0000-4000-8000-0000000000e1' $$,
  'club admins manage their club''s events');

select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a3');
select is((select count(*)::int from public.club_announcements where club_id = '5e000000-0000-4000-8000-0000000000c1'), 1, 'members read announcements');
select throws_ok($$ insert into public.club_announcements (club_id, author_id, title, body) values
                   ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000a3', 'x', 'y') $$,
  '42501', null, 'plain members cannot post announcements');
select is((select count(*)::int from public.club_roster('5e000000-0000-4000-8000-0000000000c1')), 4, 'members see the active roster');
select is((select count(*)::int from public.club_invites), 0, 'members cannot see invite codes');

select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a9');
select is((select count(*)::int from public.club_announcements), 0, 'outsiders cannot read announcements');
select is((select count(*)::int from public.club_members where club_id = '5e000000-0000-4000-8000-0000000000c1'), 0, 'outsiders cannot list members');
select throws_ok($$ select * from public.club_roster('5e000000-0000-4000-8000-0000000000c1') $$, '42501', null, 'outsiders cannot read the roster');
select throws_ok($$ select * from public.club_leaderboard('5e000000-0000-4000-8000-0000000000c1', current_date) $$, '42501', null,
  'outsiders cannot read the club leaderboard');
select is((select members::int from public.club_stats(array['5e000000-0000-4000-8000-0000000000c1'::uuid])), 4, 'anyone sees member counts');

-- ---------------------------------------------------------------- invites
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a1');
insert into public.club_invites (id, club_id, created_by, max_uses) values
  ('5e000000-0000-4000-8000-0000000000f1', '5e000000-0000-4000-8000-0000000000c3', '5e000000-0000-4000-8000-0000000000a1', 1);
select is(length((select code from public.club_invites where id = '5e000000-0000-4000-8000-0000000000f1')), 24, 'invite codes are 96 random bits');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a9');
select throws_ok($$ select public.join_club_with_invite('not-a-real-code') $$, 'P0002', null, 'a wrong code is refused');
reset role;
select set_config('hyd.test_code', (select code from public.club_invites where id = '5e000000-0000-4000-8000-0000000000f1'), true);
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a9');
select is(public.join_club_with_invite(current_setting('hyd.test_code')), '5e000000-0000-4000-8000-0000000000c3'::uuid,
  'a valid invite admits the runner to an invite-only club');
select pg_temp.act_as('5e000000-0000-4000-8000-0000000000a4');
select throws_ok($$ select public.join_club_with_invite(current_setting('hyd.test_code')) $$, 'P0002', null, 'a used-up invite is refused');

reset role;
select ok((select count(*) from public.audit_log where action like 'club_member.%' and target_id = '5e000000-0000-4000-8000-0000000000c1') >= 4,
  'membership changes are audited');

select * from finish();
rollback;
