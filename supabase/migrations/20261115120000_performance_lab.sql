-- Performance Lab v1 (Release 2, workstream B).
--
-- Every figure is aggregated in the database from the caller's own ready
-- activities (invoker rights + auth.uid(), so RLS also applies). Nothing here
-- is estimated unless its name says so, and thresholds are parameters with
-- documented defaults (docs/performance-lab.md).

-- Totals for a period.
create function public.my_activity_summary(p_from timestamptz, p_to timestamptz, p_timezone text default 'Asia/Kolkata')
returns table (
  activities bigint,
  distance_m numeric,
  moving_seconds bigint,
  elapsed_seconds bigint,
  elevation_gain_m numeric,
  avg_pace_s integer,
  active_days bigint,
  longest_m numeric,
  runs bigint,
  walks bigint,
  hikes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*),
         coalesce(sum(a.distance_m), 0),
         coalesce(sum(a.moving_seconds), 0),
         coalesce(sum(a.elapsed_seconds), 0),
         coalesce(sum(a.elevation_gain_m), 0),
         case when sum(a.distance_m) >= 100 then round(sum(a.moving_seconds) / (sum(a.distance_m) / 1000))::integer end,
         count(distinct (a.started_at at time zone p_timezone)::date),
         max(a.distance_m),
         count(*) filter (where a.activity_type in ('run', 'walk_run')),
         count(*) filter (where a.activity_type = 'walk'),
         count(*) filter (where a.activity_type = 'hike')
  from public.activities a
  where a.user_id = (select auth.uid()) and a.status = 'ready'
    and a.started_at >= p_from and a.started_at < p_to;
$$;

-- Distance, time and pace per week (Monday start, local time) in a period.
create function public.my_weekly_series(p_from timestamptz, p_to timestamptz, p_timezone text default 'Asia/Kolkata',
                                        p_types text[] default array['run', 'walk_run', 'walk', 'hike'])
returns table (week_start date, activities bigint, distance_m numeric, moving_seconds bigint, avg_pace_s integer, active_days bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('week', (a.started_at at time zone p_timezone))::date as wk,
         count(*),
         sum(a.distance_m),
         sum(a.moving_seconds),
         case when sum(a.distance_m) >= 100 then round(sum(a.moving_seconds) / (sum(a.distance_m) / 1000))::integer end,
         count(distinct (a.started_at at time zone p_timezone)::date)
  from public.activities a
  where a.user_id = (select auth.uid()) and a.status = 'ready'
    and a.started_at >= p_from and a.started_at < p_to
    and a.activity_type = any (p_types)
  group by wk
  order by wk
  limit 520;
$$;

-- Fastest GPS best effort per distance across all ready runs, with the activity.
create function public.my_best_efforts()
returns table (distance_key text, seconds integer, activity_id uuid, started_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (e.key) e.key, e.value::integer, a.id, a.started_at
  from public.activities a, jsonb_each_text(a.best_efforts) e
  where a.user_id = (select auth.uid()) and a.status = 'ready' and a.activity_type in ('run', 'walk_run')
  order by e.key, e.value::integer, a.started_at;
$$;

-- Average pace by distance band for runs in a period.
create function public.my_pace_by_distance(p_from timestamptz, p_to timestamptz)
returns table (band text, activities bigint, avg_pace_s integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.band, count(a.id),
         case when sum(a.distance_m) >= 100 then round(sum(a.moving_seconds) / (sum(a.distance_m) / 1000))::integer end
  from (values ('under 3 km', 0, 3000, 1), ('3–6 km', 3000, 6000, 2), ('6–11 km', 6000, 11000, 3),
               ('11–22 km', 11000, 22000, 4), ('22 km and over', 22000, 1000000, 5)) b(band, lo, hi, ord)
  left join public.activities a
    on a.user_id = (select auth.uid()) and a.status = 'ready' and a.activity_type in ('run', 'walk_run')
   and a.distance_m >= b.lo and a.distance_m < b.hi and a.started_at >= p_from and a.started_at < p_to
  group by b.band, b.ord
  order by b.ord;
$$;

-- Training mix in a period, inferred from pace and distance relative to the
-- runner's own median run over the previous 90 days (not heart rate):
--   long      distance >= p_long_factor × median distance and >= 8 km
--   hard      pace at least p_hard_pct % faster than the median pace
--   recovery  under 5 km and pace at least p_easy_pct % slower than the median
--   easy      everything else; walks and hikes are counted separately.
-- Strength, mobility and conditioning come from logged workouts.
create function public.my_training_mix(p_from timestamptz, p_to timestamptz,
                                       p_long_factor numeric default 1.5, p_hard_pct numeric default 7, p_easy_pct numeric default 10)
returns table (category text, sessions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select percentile_cont(0.5) within group (order by a.distance_m) as med_d,
           percentile_cont(0.5) within group (order by a.avg_pace_s) as med_p
    from public.activities a
    where a.user_id = (select auth.uid()) and a.status = 'ready' and a.activity_type in ('run', 'walk_run')
      and a.started_at >= p_from - interval '90 days' and a.started_at < p_to and a.avg_pace_s is not null
  ),
  classified as (
    select case
             when a.activity_type in ('walk', 'hike') then 'walk_or_hike'
             when b.med_d is null or a.avg_pace_s is null then 'easy'
             when a.distance_m >= greatest(b.med_d * p_long_factor, 8000) then 'long'
             when a.avg_pace_s <= b.med_p * (1 - p_hard_pct / 100) then 'hard'
             when a.distance_m < 5000 and a.avg_pace_s >= b.med_p * (1 + p_easy_pct / 100) then 'recovery'
             else 'easy'
           end as category
    from public.activities a cross join base b
    where a.user_id = (select auth.uid()) and a.status = 'ready' and a.started_at >= p_from and a.started_at < p_to
    union all
    select w.workout_type
    from public.workout_logs w
    where w.user_id = (select auth.uid()) and w.status = 'completed'
      and w.workout_type in ('strength', 'mobility', 'conditioning', 'cross_training')
      and w.started_at >= p_from and w.started_at < p_to
  )
  select category, count(*) from classified group by category order by count(*) desc;
$$;

-- Activities on the same route as p_activity_id: start and end each within
-- p_endpoint_m, distance within p_distance_pct %, and the paths never more
-- than about p_shape_m apart (discrete Hausdorff distance). Owner only.
create function public.my_route_matches(p_activity_id uuid, p_endpoint_m numeric default 200,
                                        p_distance_pct numeric default 5, p_shape_m numeric default 120)
returns table (activity_id uuid, started_at timestamptz, distance_m numeric, moving_seconds integer,
               avg_pace_s integer, elevation_gain_m numeric, hausdorff_m numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with ref as (
    select t.path, a.distance_m from public.activity_tracks t join public.activities a on a.id = t.activity_id
    where t.activity_id = p_activity_id and t.user_id = (select auth.uid()) and t.path is not null
  )
  select a.id, a.started_at, a.distance_m, a.moving_seconds, a.avg_pace_s, a.elevation_gain_m,
         round((extensions.st_hausdorffdistance(t.path::extensions.geometry, r.path::extensions.geometry) * 111320)::numeric, 0)
  from ref r
  join public.activity_tracks t on t.user_id = (select auth.uid()) and t.path is not null
  join public.activities a on a.id = t.activity_id and a.status = 'ready'
  where abs(a.distance_m - r.distance_m) <= r.distance_m * p_distance_pct / 100
    and extensions.st_dwithin(extensions.st_startpoint(t.path::extensions.geometry)::extensions.geography,
                              extensions.st_startpoint(r.path::extensions.geometry)::extensions.geography, p_endpoint_m)
    and extensions.st_dwithin(extensions.st_endpoint(t.path::extensions.geometry)::extensions.geography,
                              extensions.st_endpoint(r.path::extensions.geometry)::extensions.geography, p_endpoint_m)
    and extensions.st_hausdorffdistance(t.path::extensions.geometry, r.path::extensions.geometry) * 111320 <= p_shape_m
  order by a.started_at
  limit 200;
$$;

-- A year in running: totals plus the highlights the data supports.
create function public.my_year_in_running(p_year integer, p_timezone text default 'Asia/Kolkata')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (make_date(p_year, 1, 1)::timestamp at time zone p_timezone) as f,
           (make_date(p_year + 1, 1, 1)::timestamp at time zone p_timezone) as t
  ),
  acts as (
    select a.* from public.activities a, bounds b
    where a.user_id = (select auth.uid()) and a.status = 'ready' and a.started_at >= b.f and a.started_at < b.t
  ),
  months as (
    select extract(month from (started_at at time zone p_timezone))::int as m, sum(distance_m) as d, count(*) as n
    from acts group by 1
  ),
  repeated as (
    -- Same start (to ~100 m) and distance (to 500 m) counts as the same route.
    select round(extensions.st_y(extensions.st_startpoint(public_path::extensions.geometry))::numeric, 3) as lat,
           round(extensions.st_x(extensions.st_startpoint(public_path::extensions.geometry))::numeric, 3) as lon,
           round(distance_m / 500) as dband, count(*) as n, min(id::text) as example
    from acts where public_path is not null group by 1, 2, 3 having count(*) >= 2 order by n desc limit 1
  )
  select jsonb_build_object(
    'year', p_year,
    'activities', (select count(*) from acts),
    'distanceM', (select coalesce(sum(distance_m), 0) from acts),
    'movingSeconds', (select coalesce(sum(moving_seconds), 0) from acts),
    'elevationGainM', (select coalesce(sum(elevation_gain_m), 0) from acts),
    'longest', (select jsonb_build_object('id', id, 'distanceM', distance_m, 'startedAt', started_at) from acts order by distance_m desc limit 1),
    'fastest5k', (select jsonb_build_object('id', id, 'seconds', (best_efforts ->> '5k')::int, 'startedAt', started_at)
                  from acts where best_efforts ? '5k' and activity_type in ('run', 'walk_run')
                  order by (best_efforts ->> '5k')::int limit 1),
    'mostActiveMonth', (select jsonb_build_object('month', m, 'distanceM', d, 'activities', n) from months order by d desc limit 1),
    'mostRepeatedRoute', (select jsonb_build_object('times', n, 'exampleActivityId', example) from repeated),
    'groupRunsAttended', (select count(*) from public.event_rsvps r join public.events e on e.id = r.event_id, bounds b
                          where r.user_id = (select auth.uid()) and r.checked_in_at is not null and e.series_id is not null
                            and e.starts_at >= b.f and e.starts_at < b.t),
    'eventsAttended', (select count(*) from public.event_rsvps r join public.events e on e.id = r.event_id, bounds b
                       where r.user_id = (select auth.uid()) and r.checked_in_at is not null and e.starts_at >= b.f and e.starts_at < b.t),
    'clubs', (select count(*) from public.club_members m where m.user_id = (select auth.uid()) and m.status = 'active')
  );
$$;

revoke all on function public.my_activity_summary(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.my_weekly_series(timestamptz, timestamptz, text, text[]) from public, anon;
revoke all on function public.my_best_efforts() from public, anon;
revoke all on function public.my_pace_by_distance(timestamptz, timestamptz) from public, anon;
revoke all on function public.my_training_mix(timestamptz, timestamptz, numeric, numeric, numeric) from public, anon;
revoke all on function public.my_route_matches(uuid, numeric, numeric, numeric) from public, anon;
revoke all on function public.my_year_in_running(integer, text) from public, anon;
grant execute on function public.my_activity_summary(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.my_weekly_series(timestamptz, timestamptz, text, text[]) to authenticated;
grant execute on function public.my_best_efforts() to authenticated;
grant execute on function public.my_pace_by_distance(timestamptz, timestamptz) to authenticated;
grant execute on function public.my_training_mix(timestamptz, timestamptz, numeric, numeric, numeric) to authenticated;
grant execute on function public.my_route_matches(uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.my_year_in_running(integer, text) to authenticated;
