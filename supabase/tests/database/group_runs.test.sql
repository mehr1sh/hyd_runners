-- pgTAP: group-run series and scheduling (migration 20261112120000_group_runs).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('6f000000-0000-4000-8000-0000000000d1', 'gr.m@example.test', '{"display_name":"Gr Manager"}', 'authenticated', 'authenticated'),
  ('6f000000-0000-4000-8000-0000000000a1', 'gr.a@example.test', '{"display_name":"Gr Club Admin"}', 'authenticated', 'authenticated'),
  ('6f000000-0000-4000-8000-0000000000a2', 'gr.r@example.test', '{"display_name":"Gr Runner"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('6f000000-0000-4000-8000-0000000000d1', 'programme_manager');
insert into public.clubs (id, slug, name, join_policy) values
  ('6f000000-0000-4000-8000-0000000000c1', 'gr-test-club', 'Gr Club', 'open'),
  ('6f000000-0000-4000-8000-0000000000c2', 'gr-other-club', 'Gr Other', 'open');
insert into public.club_members (club_id, user_id, role, status, joined_at) values
  ('6f000000-0000-4000-8000-0000000000c1', '6f000000-0000-4000-8000-0000000000a1', 'admin', 'active', now());

-- ---------------------------------------------------------------- who may create a series
select pg_temp.act_as('6f000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$ insert into public.group_run_series (title, weekday, start_time, created_by)
     values ('Rogue run', 6, '06:00', '6f000000-0000-4000-8000-0000000000a2') $$,
  '42501', null, 'runners cannot create series');
select pg_temp.act_as('6f000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.group_run_series (id, club_id, title, weekday, start_time, created_by, capacity, beginner_friendly)
     values ('6f000000-0000-4000-8000-0000000000f1', '6f000000-0000-4000-8000-0000000000c1', 'Saturday dawn loop', 6, '06:00',
             '6f000000-0000-4000-8000-0000000000a1', 30, true) $$,
  'a club admin creates a series for their club');
select throws_ok(
  $$ insert into public.group_run_series (club_id, title, weekday, start_time, created_by)
     values ('6f000000-0000-4000-8000-0000000000c2', 'Not mine', 6, '06:00', '6f000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'but not for another club');
select throws_ok(
  $$ insert into public.group_run_series (title, weekday, start_time, created_by)
     values ('No club', 6, '06:00', '6f000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'and not a city-wide series');
select throws_ok(
  $$ insert into public.group_run_series (club_id, title, weekday, start_time, created_by, timezone)
     values ('6f000000-0000-4000-8000-0000000000c1', 'Bad tz', 6, '06:00', '6f000000-0000-4000-8000-0000000000a1', 'Mars/Base') $$,
  '22023', null, 'unknown timezones are rejected');
select throws_ok(
  $$ insert into public.group_run_series (club_id, title, weekday, start_time, created_by, pace_groups)
     values ('6f000000-0000-4000-8000-0000000000c1', 'Bad pace', 6, '06:00', '6f000000-0000-4000-8000-0000000000a1',
             '[{"label": "Backwards", "min_pace_seconds": 400, "max_pace_seconds": 300}]') $$,
  '23514', null, 'pace templates must run fastest to slowest');

-- ---------------------------------------------------------------- scheduling
select is(public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 4), 4,
  'scheduling four weeks creates four Saturday runs');
select is(public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 4), 0,
  'scheduling again creates nothing new');
select is(public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 6), 2,
  'extending the window adds only the missing weeks');
select is(
  (select count(distinct extract(isodow from starts_at at time zone 'Asia/Kolkata'))::int || ':' ||
          min((starts_at at time zone 'Asia/Kolkata')::time)::text
     from public.events where series_id = '6f000000-0000-4000-8000-0000000000f1'),
  '1:06:00:00', 'every run is on the series weekday at the local start time');
select is(
  (select count(*)::int from public.events where series_id = '6f000000-0000-4000-8000-0000000000f1'
      and club_id = '6f000000-0000-4000-8000-0000000000c1' and category = 'beginner' and capacity = 30
      and status = 'published' and ends_at - starts_at = interval '60 minutes'),
  6, 'runs inherit the club, beginner category, capacity and duration');
select is(
  (select count(*)::int from public.event_pace_groups g join public.events e on e.id = g.event_id
    where e.series_id = '6f000000-0000-4000-8000-0000000000f1'),
  30, 'each run gets the five default pace groups');
select is(
  (select string_agg(label, ', ' order by sort_order) from public.event_pace_groups g
     where g.event_id = (select id from public.events where series_id = '6f000000-0000-4000-8000-0000000000f1' order by starts_at limit 1)),
  '5:00–5:30, 5:30–6:00, 6:00–6:30, 6:30–7:30, Run-walk', 'the default pace groups cover 5:00 to 7:30 and run-walk');
select lives_ok(
  $$ update public.events set description = 'Bring a headlamp'
      where id = (select id from public.events where series_id = '6f000000-0000-4000-8000-0000000000f1' order by starts_at limit 1) $$,
  'the club admin manages the scheduled runs');
select throws_ok($$ select public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 20) $$, '22023', null,
  'scheduling is limited to eight weeks ahead');

select pg_temp.act_as('6f000000-0000-4000-8000-0000000000a2');
select throws_ok($$ select public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 1) $$, '42501', null,
  'runners cannot schedule runs');
select is((select count(*)::int from public.group_run_series where id = '6f000000-0000-4000-8000-0000000000f1'), 1,
  'anyone can read an active series');
update public.group_run_series set title = 'hijacked' where id = '6f000000-0000-4000-8000-0000000000f1';
reset role;
select is((select title from public.group_run_series where id = '6f000000-0000-4000-8000-0000000000f1'), 'Saturday dawn loop',
  'runners cannot edit a series');

select pg_temp.act_as('6f000000-0000-4000-8000-0000000000a1');
update public.group_run_series set active = false where id = '6f000000-0000-4000-8000-0000000000f1';
select throws_ok($$ select public.schedule_series_runs('6f000000-0000-4000-8000-0000000000f1', 1) $$, '23514', null,
  'a paused series schedules nothing');

select * from finish();
rollback;
