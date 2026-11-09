-- pgTAP: storytelling (migration 20261129120000_storytelling): reflections are
-- private unless shared on an activity the viewer can see; a runner can only
-- reflect on their own activity; the showcase shows only earned badges and
-- published routes, hides race history unless opted in, and respects blocks.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('f4000000-0000-4000-8000-0000000000a1', 'st.a@example.test', '{"display_name":"Story A"}', 'authenticated', 'authenticated'),
  ('f4000000-0000-4000-8000-0000000000b1', 'st.b@example.test', '{"display_name":"Story B"}', 'authenticated', 'authenticated'),
  ('f4000000-0000-4000-8000-0000000000c1', 'st.c@example.test', '{"display_name":"Story C"}', 'authenticated', 'authenticated');
insert into public.activities (id, user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds, moving_seconds,
                               moving_source, distance_m, avg_pace_s, has_gps, visibility, best_efforts) values
  ('f4000000-0000-4000-8000-00000000ac01', 'f4000000-0000-4000-8000-0000000000a1', 'run', 'ready', 'gpx', now() - interval '1 day',
   now() - interval '1 day' + interval '30 minutes', 1800, 1800, 'derived', 5000, 360, false, 'public', '{"5k": 1800}'),
  ('f4000000-0000-4000-8000-00000000ac02', 'f4000000-0000-4000-8000-0000000000a1', 'run', 'ready', 'gpx', now() - interval '2 days',
   now() - interval '2 days' + interval '30 minutes', 1800, 1800, 'derived', 5000, 360, false, 'private', '{}');
insert into public.badges (code, title, description) values ('story-test-badge', 'Story badge', 'For tests') on conflict do nothing;
insert into public.user_badges (user_id, badge_code, earned_at) values ('f4000000-0000-4000-8000-0000000000a1', 'story-test-badge', now());
insert into public.user_blocks (blocker_id, blocked_id) values ('f4000000-0000-4000-8000-0000000000a1', 'f4000000-0000-4000-8000-0000000000c1');

select pg_temp.act_as('f4000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.activity_reflections (activity_id, user_id, difficult, enjoyed, share_story) values
  ('f4000000-0000-4000-8000-00000000ac01', 'f4000000-0000-4000-8000-0000000000a1', 'The last hill', 'Sunrise at the lake', true) $$,
  'a runner writes a shared reflection');
select lives_ok($$ insert into public.activity_reflections (activity_id, user_id, difficult, share_story) values
  ('f4000000-0000-4000-8000-00000000ac02', 'f4000000-0000-4000-8000-0000000000a1', 'Private thought', true) $$,
  'and one on a private activity');
select lives_ok($$ update public.profiles set showcase_badges = '{story-test-badge,never-earned}', profile_theme = 'night'
  where id = 'f4000000-0000-4000-8000-0000000000a1' $$, 'and customises the profile');

select pg_temp.act_as('f4000000-0000-4000-8000-0000000000b1');
select throws_ok($$ insert into public.activity_reflections (activity_id, user_id, story) values
  ('f4000000-0000-4000-8000-00000000ac01', 'f4000000-0000-4000-8000-0000000000b1', 'Not mine') $$, '42501', null,
  'nobody reflects on someone else''s activity');
select is((select count(*) from public.activity_reflections), 1::bigint, 'shared stories show only on activities others can see');
select is((select difficult from public.activity_reflections), 'The last hill', 'the shared story is readable');
select is(jsonb_array_length(public.runner_showcase('f4000000-0000-4000-8000-0000000000a1')->'badges'), 1,
  'only earned badges are showcased');
select is(public.runner_showcase('f4000000-0000-4000-8000-0000000000a1')->>'theme', 'night', 'the theme is shown');
select ok(public.runner_showcase('f4000000-0000-4000-8000-0000000000a1')->'races' = 'null'::jsonb, 'race history is hidden by default');
reset role;
update public.profiles set show_race_history = true where id = 'f4000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('f4000000-0000-4000-8000-0000000000b1');
select is(public.runner_showcase('f4000000-0000-4000-8000-0000000000a1')->'bests'->>'5k', '1800', 'opted-in bests come from shared activities');
select pg_temp.act_as('f4000000-0000-4000-8000-0000000000c1');
select is(public.runner_showcase('f4000000-0000-4000-8000-0000000000a1'), null, 'blocked runners see nothing');

select * from finish();
rollback;
