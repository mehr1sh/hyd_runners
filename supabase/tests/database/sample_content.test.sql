-- pgTAP: sample community content (migration 20261108150000). Seed rows have
-- ids starting with 5eed and no author; existing content is preserved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create temp view seed_locations as select * from public.locations where id::text like '5eed0001-%';
create temp view seed_events as select * from public.events where id::text like '5eed0002-%';
create temp view seed_programmes as select * from public.programmes where id::text like '5eed0003-%';
create temp view seed_sessions as select * from public.programme_sessions where id::text like '5eed0004-%';
grant select on seed_locations, seed_events, seed_programmes, seed_sessions to anon;

-- ---------------------------------------------------------------- category
select lives_ok(
  $$ insert into public.programmes (slug, title, kind, category, level, duration_weeks, sessions_per_week)
     values ('test-running-plan', 'Test', 'custom', 'running', 'beginner', 1, 1) $$,
  'programmes accept the running category');
select throws_ok(
  $$ insert into public.programmes (slug, title, kind, category, level, duration_weeks, sessions_per_week)
     values ('test-bad-category', 'Test', 'custom', 'racing', 'beginner', 1, 1) $$,
  '23514', null, 'programmes still reject unknown categories');

-- ---------------------------------------------------------------- locations
select is((select count(*)::int from seed_locations), 12, '12 sample locations');
select is((select count(distinct lower(name))::int from seed_locations), 12, 'sample location names are unique');
select is((select count(*)::int from seed_locations where verified or created_by is not null), 0,
  'sample locations are unverified and have no author');
select is((select count(*)::int from seed_locations
           where latitude not between 17.25 and 17.60 or longitude not between 78.20 and 78.65), 0,
  'every sample location is in Hyderabad');

-- ---------------------------------------------------------------- events
select is((select count(*)::int from seed_events), 30, '30 sample events');
select is((select count(*)::int from seed_events
           where title like 'Sample: %' and description like '%not an officially organised event.'
             and created_by is null and status = 'published'), 30,
  'every sample event is labelled, published and has no author');
select is((select count(*)::int from seed_events e join seed_locations l on l.id = e.location_id), 30,
  'every sample event is at a sample location');
select is((select count(*)::int from seed_events where ends_at <= starts_at or capacity is null or capacity <= 0), 0,
  'sample events end after they start and have a capacity');
select is((select count(*)::int from seed_events where starts_at < '2026-11-08 00:00+05:30'), 5, '5 past events');
select is((select count(*)::int from seed_events where starts_at >= '2026-11-08 00:00+05:30' and starts_at < '2026-12-01 00:00+05:30'), 10,
  '10 events in the rest of November');
select is((select count(*)::int from seed_events where starts_at >= '2026-12-01 00:00+05:30' and starts_at < '2027-01-01 00:00+05:30'), 15,
  '15 events in December');
select is((select count(*)::int from seed_events e join seed_locations l on l.id = e.location_id
           where l.name like 'Gandipet%' and (e.starts_at at time zone 'Asia/Kolkata')::time < '08:00'), 0,
  'Gandipet events start after the park opens at 08:00');

-- ---------------------------------------------------------------- programmes
select is((select count(*)::int from seed_programmes), 8, '8 running plans');
select is((select count(*)::int from seed_programmes
           where category = 'running' and enrolment = 'open' and published and kind = 'custom' and owner_id is null), 8,
  'running plans are published, open enrolment and in the running category');
select is((select count(*)::int from seed_sessions), 196, '196 running plan sessions');
select is(
  (select count(*)::int from seed_programmes p
   where (select count(*) from seed_sessions s where s.programme_id = p.id) <> p.duration_weeks * p.sessions_per_week), 0,
  'each plan has weeks × sessions-per-week sessions');
select is((select count(*)::int from seed_sessions s join seed_programmes p on p.id = s.programme_id where s.week > p.duration_weeks), 0,
  'no session falls after the end of its plan');
select is(
  (select count(*)::int from (
     select programme_id, week from seed_sessions group by programme_id, week
     having count(*) filter (where is_milestone) <> 1
        or max(day) <> max(day) filter (where is_milestone)) t), 0,
  'the last session of each week is its only milestone');

-- Blocks must match the app's WorkoutBlock contract exactly, or the app shows none.
select is((select count(*)::int from seed_sessions where jsonb_array_length(blocks) = 0), 0, 'every session has blocks');
select is(
  (select count(*)::int from seed_sessions s, jsonb_array_elements(s.blocks) b
   where (select array_agg(k order by k) from jsonb_object_keys(b) k) <> array['durationSeconds', 'kind', 'notes', 'repeat', 'reps', 'sets']
      or b->>'kind' not in ('warm_up', 'run', 'walk', 'strength', 'conditioning', 'rest', 'cool_down')
      or jsonb_typeof(b->'repeat') <> 'number' or (b->>'repeat')::numeric <> 1
      or (jsonb_typeof(b->'durationSeconds') <> 'null' and (jsonb_typeof(b->'durationSeconds') <> 'number' or (b->>'durationSeconds')::numeric <= 0 or (b->>'durationSeconds')::numeric % 1 <> 0))
      or (jsonb_typeof(b->'sets') <> 'null' and (jsonb_typeof(b->'sets') <> 'number' or (b->>'sets')::numeric <= 0))
      or (jsonb_typeof(b->'reps') <> 'null' and (jsonb_typeof(b->'reps') <> 'number' or (b->>'reps')::numeric <= 0))
      or (jsonb_typeof(b->'notes') <> 'null' and (jsonb_typeof(b->'notes') <> 'string' or char_length(b->>'notes') > 200))), 0,
  'every block has the WorkoutBlock shape');

-- ---------------------------------------------------------------- existing content preserved
select is(
  (select array_agg(slug || ':' || category order by slug)::text from public.programmes where id in (
     '0547c1bc-2e00-51d2-8107-df7f55515630', 'f7dab285-cb63-54d8-b150-da3c42120af5', '81afc8f6-783e-56f8-a138-300cc00c9c69',
     '946621c7-65f7-5cba-8454-9932a143cf03', '114ba3cd-29e0-5321-9f68-b9849136403e', '6773b303-37bf-5e37-8dba-cf5d568b43d5',
     'b987567a-3446-57ae-b5f7-b93787584df3')),
  '{couch-to-5k:couch_to_5k,mobility-basics:general_fitness,recovery-essentials:general_fitness,strength-and-conditioning:general_fitness,training-and-shine:training_and_shine,upper-body-basics:general_fitness,yoga-for-runners:general_fitness}',
  'the 7 existing programmes keep their slugs and categories');
select is((select count(*)::int from public.programme_sessions where id::text not like '5eed%'), 116, 'the 116 existing sessions remain');
select is((select count(*)::int from public.badges), 16, 'the 16 badges remain');
select is((select count(*)::int from public.programmes where slug <> 'test-running-plan'), 15, '15 programmes in total');
select is((select count(*)::int from public.programme_sessions), 312, '312 programme sessions in total');

-- ---------------------------------------------------------------- no fabricated activity
select is(
  (select count(*)::int from public.event_rsvps r join seed_events e on e.id = r.event_id)
  + (select count(*)::int from public.enrollments n join seed_programmes p on p.id = n.programme_id)
  + (select count(*)::int from public.workout_logs w join seed_sessions s on s.id = w.programme_session_id), 0,
  'the migration creates no RSVPs, enrolments or workouts');

-- ---------------------------------------------------------------- visible to the public
set local role anon;
select is(
  (select count(*)::int from seed_events) || '/' || (select count(*)::int from seed_locations) || '/' ||
  (select count(*)::int from seed_programmes) || '/' || (select count(*)::int from seed_sessions),
  '30/12/8/196', 'signed-out visitors can see the sample events, locations and plans');
reset role;

select * from finish();
rollback;
