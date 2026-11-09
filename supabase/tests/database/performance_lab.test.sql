-- pgTAP: Performance Lab aggregates (migration 20261115120000_performance_lab).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- A ready activity heading east from (78.42, 17.42) for `dist` metres.
create function pg_temp.act(id uuid, owner uuid, start timestamptz, dist numeric, moving int, typ text, efforts jsonb,
                            lat0 numeric default 17.42, lon0 numeric default 78.42) returns void language sql as $$
  insert into public.activities (id, user_id, activity_type, status, source_format, started_at, ended_at, elapsed_seconds,
                                 moving_seconds, moving_source, distance_m, avg_pace_s, elevation_gain_m, best_efforts, has_gps, public_path)
  values (id, owner, typ, 'ready', 'gpx', start, start + make_interval(secs => moving), moving, moving, 'derived', dist,
          round(moving / (dist / 1000)), 10, efforts, true,
          extensions.st_geogfromtext(format('SRID=4326;LINESTRING(%s %s, %s %s)', lon0 + 0.002, lat0, lon0 + dist / 106000 - 0.002, lat0)));
  insert into public.activity_tracks (activity_id, user_id, path, samples, file_path, file_sha256, file_bytes)
  values (id, owner, extensions.st_geogfromtext(format('SRID=4326;LINESTRING(%s %s, %s %s, %s %s)', lon0, lat0,
                                                       lon0 + dist / 212000, lat0, lon0 + dist / 106000, lat0)),
          '[]', 'x', md5(id::text) || md5(id::text), 1);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('9c000000-0000-4000-8000-0000000000a1', 'pl.a@example.test', '{"display_name":"Pl Runner"}', 'authenticated', 'authenticated'),
  ('9c000000-0000-4000-8000-0000000000a2', 'pl.b@example.test', '{"display_name":"Pl Other"}', 'authenticated', 'authenticated');

select pg_temp.act('9c000000-0000-4000-8000-0000000000f1', '9c000000-0000-4000-8000-0000000000a1', '2026-10-05 06:00+05:30', 5000, 1800, 'run', '{"1k": 330, "5k": 1790}');
select pg_temp.act('9c000000-0000-4000-8000-0000000000f2', '9c000000-0000-4000-8000-0000000000a1', '2026-10-12 06:00+05:30', 5050, 1700, 'run', '{"1k": 310, "5k": 1690}');
select pg_temp.act('9c000000-0000-4000-8000-0000000000f3', '9c000000-0000-4000-8000-0000000000a1', '2026-10-19 06:00+05:30', 12000, 4500, 'run', '{"1k": 340, "5k": 1850, "10k": 3700}');
select pg_temp.act('9c000000-0000-4000-8000-0000000000f4', '9c000000-0000-4000-8000-0000000000a1', '2026-10-20 18:00+05:30', 3000, 1800, 'walk', '{}');
-- Same distance, different place: not the same route.
select pg_temp.act('9c000000-0000-4000-8000-0000000000f5', '9c000000-0000-4000-8000-0000000000a1', '2026-10-26 06:00+05:30', 5000, 1750, 'run', '{"5k": 1750}', 17.50, 78.50);
-- Someone else's faster run never appears.
select pg_temp.act('9c000000-0000-4000-8000-0000000000f9', '9c000000-0000-4000-8000-0000000000a2', '2026-10-06 06:00+05:30', 5000, 1200, 'run', '{"5k": 1200}');

select pg_temp.act_as('9c000000-0000-4000-8000-0000000000a1');
select is(
  (select activities || ':' || round(distance_m)::text || ':' || runs || ':' || walks || ':' || active_days
     from public.my_activity_summary('2026-10-01 00:00+05:30', '2026-11-01 00:00+05:30')),
  '5:30050:4:1:5', 'the summary totals only the caller''s activities in the period');
select is(
  (select avg_pace_s from public.my_activity_summary('2026-10-01 00:00+05:30', '2026-10-13 00:00+05:30')),
  348, 'average pace is total moving time over total distance (3500 s / 10.05 km)');
select is((select count(*)::int from public.my_activity_summary('2026-12-01', '2027-01-01') where activities = 0), 1,
  'an empty period returns zeros');
select is(
  (select string_agg(week_start::text || '=' || round(distance_m)::text, ',' order by week_start)
     from public.my_weekly_series('2026-10-01 00:00+05:30', '2026-11-01 00:00+05:30', 'Asia/Kolkata', array['run'])),
  '2026-10-05=5000,2026-10-12=5050,2026-10-19=12000,2026-10-26=5000', 'weekly series start on Monday and filter by type');
select is(
  (select string_agg(distance_key || '=' || seconds, ',' order by distance_key) from public.my_best_efforts()),
  '10k=3700,1k=310,5k=1690', 'best efforts are the caller''s fastest per distance');
select is((select activity_id::text from public.my_best_efforts() where distance_key = '5k'),
  '9c000000-0000-4000-8000-0000000000f2', 'and point at the activity they came from');
select is(
  (select string_agg(band || '=' || activities, ',') from public.my_pace_by_distance('2026-10-01', '2026-11-01') where activities > 0),
  '3–6 km=3,11–22 km=1', 'runs are grouped into distance bands');
select is(
  (select string_agg(category || '=' || sessions, ',' order by category) from public.my_training_mix('2026-10-01 00:00+05:30', '2026-11-01 00:00+05:30')),
  'easy=3,long=1,walk_or_hike=1', 'training mix: with the default 7% threshold no run is hard against a 355 s/km median');
select is(
  (select string_agg(category || '=' || sessions, ',' order by category) from public.my_training_mix('2026-10-01 00:00+05:30', '2026-11-01 00:00+05:30', 1.5, 4)),
  'easy=2,hard=1,long=1,walk_or_hike=1', 'the hard threshold is tuneable (4%: the 337 s/km run counts as hard)');
select is(
  (select string_agg(activity_id::text, ',' order by started_at) from public.my_route_matches('9c000000-0000-4000-8000-0000000000f1')),
  '9c000000-0000-4000-8000-0000000000f1,9c000000-0000-4000-8000-0000000000f2', 'repeated routes match, a run elsewhere does not');
select is((select count(*)::int from public.my_route_matches('9c000000-0000-4000-8000-0000000000f1', 200, 0.1)), 1,
  'tightening the distance tolerance drops the 1% longer run');
select is((select count(*)::int from public.my_route_matches('9c000000-0000-4000-8000-0000000000f9')), 0,
  'nobody can match against someone else''s activity');
select is(
  (select (j ->> 'activities') || ':' || round((j ->> 'distanceM')::numeric)::text || ':' || (j -> 'longest' ->> 'distanceM') || ':' ||
          (j -> 'fastest5k' ->> 'seconds') || ':' || (j -> 'mostActiveMonth' ->> 'month')
     from public.my_year_in_running(2026) j),
  '5:30050:12000.0:1690:10', 'the year summary has totals and highlights');
select is((select public.my_year_in_running(2026) -> 'mostRepeatedRoute' ->> 'times'), '2', 'the most repeated route is found');
select is((select public.my_year_in_running(2025) ->> 'activities'), '0', 'an empty year is empty, not invented');

select pg_temp.act_as('9c000000-0000-4000-8000-0000000000a2');
select is((select activities::int from public.my_activity_summary('2026-01-01', '2027-01-01')), 1, 'each runner sees only their own data');
reset role;
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name like 'my\_%' and grantee = 'anon'
      and routine_name in ('my_activity_summary', 'my_weekly_series', 'my_best_efforts', 'my_pace_by_distance',
                           'my_training_mix', 'my_route_matches', 'my_year_in_running')),
  0, 'signed-out visitors cannot call the analytics');

select * from finish();
rollback;
