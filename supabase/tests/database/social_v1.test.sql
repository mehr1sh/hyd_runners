-- pgTAP: Social v1 (migration 20261118120000_social_v1): follows and approval,
-- followers-only visibility, blocks both ways, kudos, comments, names, search,
-- the feed, and reports and moderator hiding of activities and comments.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.act(id uuid, owner uuid, vis text, start timestamptz) returns void language sql as $$
  insert into public.activities (id, user_id, activity_type, name, visibility, status, source_format, started_at, ended_at,
                                 elapsed_seconds, moving_seconds, moving_source, distance_m, avg_pace_s, has_gps, public_path)
  values (id, owner, 'run', 'Run ' || vis, vis, 'ready', 'gpx', start, start + interval '30 minutes', 1800, 1800, 'derived',
          5000, 360, true, extensions.st_geogfromtext('SRID=4326;LINESTRING(78.42 17.42, 78.46 17.42)'));
$$;

-- A shares; B follows; C is a stranger; D gets blocked; M moderates.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('5a000000-0000-4000-8000-0000000000a1', 'so.a@example.test', '{"display_name":"Sora Asha"}', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-0000000000b1', 'so.b@example.test', '{"display_name":"Sora Bilal"}', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-0000000000c1', 'so.c@example.test', '{"display_name":"Sora Chen"}', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-0000000000d1', 'so.d@example.test', '{"display_name":"Sora Dev"}', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-0000000000e1', 'so.m@example.test', '{"display_name":"Sora Mod"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('5a000000-0000-4000-8000-0000000000e1', 'programme_manager');

select pg_temp.act('5a000000-0000-4000-8000-0000000000f1', '5a000000-0000-4000-8000-0000000000a1', 'public', '2026-11-01 06:00+05:30');
select pg_temp.act('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000a1', 'followers', '2026-11-02 06:00+05:30');
select pg_temp.act('5a000000-0000-4000-8000-0000000000f3', '5a000000-0000-4000-8000-0000000000a1', 'private', '2026-11-03 06:00+05:30');

create temp table r (k text, v text);
grant all on r to authenticated;

-- ---------------------------------------------------------------- follow requests
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000b1');
select lives_ok($$ insert into public.follows (follower_id, followee_id) values
  ('5a000000-0000-4000-8000-0000000000b1', '5a000000-0000-4000-8000-0000000000a1') $$, 'B asks to follow A');
select is((select status from public.follows where follower_id = '5a000000-0000-4000-8000-0000000000b1'), 'pending',
  'approval is required by default');
select throws_ok($$ insert into public.follows (follower_id, followee_id, status) values
  ('5a000000-0000-4000-8000-0000000000b1', '5a000000-0000-4000-8000-0000000000c1', 'accepted') $$,
  '42501', null, 'followers cannot set their own status');
select throws_ok($$ insert into public.follows (follower_id, followee_id) values
  ('5a000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'nobody follows on someone else''s behalf');
select is((select count(*) from public.activities where id = '5a000000-0000-4000-8000-0000000000f2'), 0::bigint,
  'a pending follower cannot see followers-only activities');
select results_eq($$ update public.follows set status = 'accepted' where followee_id = '5a000000-0000-4000-8000-0000000000a1' returning 1 $$,
  $$ select 1 where false $$, 'the follower cannot accept their own request');

select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
select lives_ok($$ update public.follows set status = 'accepted' where follower_id = '5a000000-0000-4000-8000-0000000000b1' $$,
  'A accepts');
select ok((select accepted_at is not null from public.follows where follower_id = '5a000000-0000-4000-8000-0000000000b1'),
  'acceptance time is recorded');
select throws_ok($$ update public.follows set status = 'pending' where follower_id = '5a000000-0000-4000-8000-0000000000b1' $$,
  '42501', null, 'an accepted follow cannot be changed back');

-- ---------------------------------------------------------------- visibility
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000b1');
select is((select string_agg(visibility, ',' order by visibility) from public.activities
            where user_id = '5a000000-0000-4000-8000-0000000000a1'), 'followers,public',
  'an accepted follower sees public and followers-only activities, not private ones');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
select is((select string_agg(visibility, ',') from public.activities
            where user_id = '5a000000-0000-4000-8000-0000000000a1'), 'public', 'a stranger sees public activities only');
select is((select count(*) from public.activity_tracks where activity_id = '5a000000-0000-4000-8000-0000000000f1'), 0::bigint,
  'nobody else ever sees the full track');

-- Auto-accept when the followee does not require approval.
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
update public.profiles set approve_followers = false where id = '5a000000-0000-4000-8000-0000000000c1';
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
insert into public.follows (follower_id, followee_id) values ('5a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000c1');
select is((select status from public.follows where follower_id = '5a000000-0000-4000-8000-0000000000a1'
            and followee_id = '5a000000-0000-4000-8000-0000000000c1'), 'accepted', 'follows are accepted at once when approval is off');
select throws_ok($$ update public.profiles set bio = repeat('x', 161) where id = '5a000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'bios are at most 160 characters');

-- ---------------------------------------------------------------- kudos and comments
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000b1');
select lives_ok($$ insert into public.activity_reactions (activity_id, user_id) values
  ('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000b1') $$, 'a follower gives kudos');
select throws_ok($$ insert into public.activity_reactions (activity_id, user_id) values
  ('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000b1') $$, '23505', null, 'once per activity');
select throws_ok($$ insert into public.activity_reactions (activity_id, user_id) values
  ('5a000000-0000-4000-8000-0000000000f3', '5a000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'not on an activity they cannot see');
select lives_ok($$ insert into public.activity_comments (id, activity_id, author_id, body) values
  ('5a000000-0000-4000-8000-0000000000c9', '5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000b1', 'Strong finish!') $$,
  'a follower comments');
select throws_ok($$ insert into public.activity_comments (activity_id, author_id, body) values
  ('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000b1', ' padded ') $$, '23514', null,
  'comments are trimmed text');
select throws_ok($$ insert into public.activity_comments (activity_id, author_id, body, hidden_at) values
  ('5a000000-0000-4000-8000-0000000000f2', '5a000000-0000-4000-8000-0000000000b1', 'x', now()) $$, '42501', null,
  'clients cannot set moderation fields');

select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
select throws_ok($$ insert into public.activity_reactions (activity_id, user_id) values
  ('5a000000-0000-4000-8000-0000000000f1', '5a000000-0000-4000-8000-0000000000a1') $$, '42501', null, 'no kudos for yourself');
select is((select author_name || ': ' || body from public.activity_comment_list('5a000000-0000-4000-8000-0000000000f2')),
  'Sora Bilal: Strong finish!', 'the owner sees comments with names');
select is((select kudos::text || '/' || comments::text from public.activity_feed() where id = '5a000000-0000-4000-8000-0000000000f2'),
  '1/1', 'the feed counts kudos and comments');

select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.activity_comments), 0::bigint, 'strangers cannot read comments on followers-only activities');

-- ---------------------------------------------------------------- feed and names
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000b1');
select is((select string_agg(name || '@' || author_name, ',' order by started_at desc) from public.activity_feed()),
  'Run followers@Sora Asha,Run public@Sora Asha', 'B''s feed: followed runner''s visible activities, newest first');
select is((select count(*) from public.activity_feed(p_before => '2026-11-02 00:00+05:30')), 1::bigint, 'the feed pages by start time');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.activity_feed()), 0::bigint, 'the feed only includes followed runners');
select is((select display_name from public.profiles where id = '5a000000-0000-4000-8000-0000000000a1'), null,
  'profiles stay private to their owner');
select is((select display_name || ':' || followers || ':' || my_follow from public.runner_profile('5a000000-0000-4000-8000-0000000000a1')),
  'Sora Asha:1:none', 'a minimal profile card');
select is((select string_agg(display_name, ',' order by display_name) from public.search_runners('sora')),
  'Sora Asha,Sora Bilal,Sora Dev,Sora Mod', 'search finds discoverable runners, never yourself');
select throws_ok($$ select * from public.search_runners('s') $$, '22023', null, 'search needs 2 characters');
select is((select count(*) from public.search_runners('%%')), 0::bigint, 'wildcards are matched literally');

-- ---------------------------------------------------------------- blocks
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000d1');
insert into public.follows (follower_id, followee_id) values ('5a000000-0000-4000-8000-0000000000d1', '5a000000-0000-4000-8000-0000000000a1');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.user_blocks (blocker_id, blocked_id) values
  ('5a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000d1') $$, 'A blocks D');
select is((select count(*) from public.follows where follower_id = '5a000000-0000-4000-8000-0000000000d1'), 0::bigint,
  'blocking removes the follow');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.activities where user_id = '5a000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'the blocked runner no longer sees even public activities');
select throws_ok($$ insert into public.follows (follower_id, followee_id) values
  ('5a000000-0000-4000-8000-0000000000d1', '5a000000-0000-4000-8000-0000000000a1') $$, '42501', null, 'and cannot follow again');
select is((select count(*) from public.runner_profile('5a000000-0000-4000-8000-0000000000a1')), 0::bigint,
  'or open the blocker''s profile');
select is((select count(*) from public.search_runners('sora asha')), 0::bigint, 'or find them');
select is((select count(*) from public.user_blocks), 0::bigint, 'blocks are private to the blocker');

-- ---------------------------------------------------------------- reports and moderation
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select public.report_content('activity', '5a000000-0000-4000-8000-0000000000f2', 'spam') $$,
  '42501', null, 'only content you can see can be reported');
select lives_ok($$ insert into r select 'act_report', public.report_content('activity', '5a000000-0000-4000-8000-0000000000f1', 'inappropriate')::text $$,
  'a stranger reports a public activity');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into r select 'comment_report', public.report_content('activity_comment', '5a000000-0000-4000-8000-0000000000c9', 'harassment')::text $$,
  'the owner reports a comment');

select pg_temp.act_as('5a000000-0000-4000-8000-0000000000e1');
select alike((select body from public.moderation_report_content((select v::uuid from r where k = 'act_report'))), 'Run public · 5.00 km%',
  'moderators see an activity summary, not its track');
select lives_ok($$ select public.resolve_report((select v::uuid from r where k = 'act_report'), 'hide_content') $$, 'hide the activity');
select lives_ok($$ select public.resolve_report((select v::uuid from r where k = 'comment_report'), 'hide_content') $$, 'hide the comment');

select pg_temp.act_as('5a000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.activities where id = '5a000000-0000-4000-8000-0000000000f1'), 0::bigint,
  'a hidden activity disappears for others');
select pg_temp.act_as('5a000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.activity_comments where id = '5a000000-0000-4000-8000-0000000000c9'), 0::bigint,
  'a hidden comment disappears for the activity owner');

select * from finish();
rollback;
