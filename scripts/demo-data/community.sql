-- HYD Runners local demo data, stage A: the community's structure.
--
-- LOCAL DEVELOPMENT ONLY. Run through `pnpm demo:seed`, which refuses any
-- non-local database and runs this file with psql inside the local Supabase
-- container in a single transaction. It is not a migration and is not listed
-- in supabase/config.toml, so neither `supabase db push` nor a production
-- deploy can run it.
--
-- Every row belongs to the fictional sample accounts created by the runner
-- (display names end in "(sample)", emails end in @demo.hydrunners.test,
-- app_metadata.demo = true). Shared objects are named "(sample)" or
-- "Sample: ..." and descriptions say they are sample content.
--
-- Ids: de<kind>-0000-4000-8000-<n>, from pg_temp.o(kind, n). Kinds:
--   0 people, 1 clubs, 2 group-run series, 3 events, 4 squads, 5 squad runs,
--   6 leagues, 7 league teams, 8 challenges, 9 race entries, 10 services,
--   11 announcements, 12 coach notes, 15 club announcements, 16 squad messages,
--   17 direct messages, 18 enrolments, 20 recovery entries, 21 strength logs,
--   22 event updates, 23 location updates.
--
-- Rows authored by a person are inserted with that person's JWT claims set,
-- so guard triggers that record the author from auth.uid() see the right
-- runner. Triggers, constraints and foreign keys all stay enabled.
-- Dates are relative to the day the seed runs (Asia/Kolkata).

\set ON_ERROR_STOP on

create function pg_temp.o(kind int, n int) returns uuid language sql immutable as $$
  select format('de%s-0000-4000-8000-%s', lpad(kind::text, 6, '0'), lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$ select pg_temp.o(0, n) $$;

-- Local date d days from today at local time t, as an instant.
create function pg_temp.at(d int, t time) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + d) + t) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.day(d int) returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date + d
$$;
-- Days from today to the most recent past (or today's) ISO weekday `dow`, minus `weeks` weeks.
create function pg_temp.past_dow(dow int, weeks int) returns int language sql stable as $$
  select -(((extract(isodow from (now() at time zone 'Asia/Kolkata'))::int - dow + 7) % 7) + 7 * weeks)
$$;
-- Days from today to the next (strictly future) ISO weekday `dow`.
create function pg_temp.next_dow(dow int) returns int language sql stable as $$
  select ((dow - extract(isodow from (now() at time zone 'Asia/Kolkata'))::int + 6) % 7) + 1
$$;

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true);
end $$;

-- Record attendance at an event that has already happened. RSVPs can only be
-- made while an event is open, so the event is briefly reopened, the RSVPs are
-- made as they would have been beforehand, and its real times are restored.
create function pg_temp.attend_past(e uuid, going uuid[], checked uuid[]) returns void language plpgsql as $$
declare s timestamptz; en timestamptz;
begin
  select starts_at, ends_at into s, en from public.events where id = e;
  update public.events set starts_at = now() + interval '1 day', ends_at = now() + interval '1 day 2 hours' where id = e;
  insert into public.event_rsvps (event_id, user_id, status) select e, u, 'going' from unnest(going) u
  on conflict do nothing;
  update public.events set starts_at = s, ends_at = en where id = e;
  update public.event_rsvps set created_at = s - interval '3 days', updated_at = s - interval '3 days',
         checked_in_at = case when user_id = any (checked) then s + interval '4 minutes' end,
         checked_in_by = case when user_id = any (checked) then user_id end
   where event_id = e;
end $$;

do $$
begin
  if not exists (select 1 from public.locations where id = '5eed0001-0000-4000-8000-000000000004')
     or not exists (select 1 from public.routes where id = '5eed0005-0000-4000-8000-000000000001') then
    raise exception 'Sample locations and routes are missing. Run the migrations (supabase db reset) first.';
  end if;
  if (select count(*) from public.profiles where id between pg_temp.p(1) and pg_temp.p(22)) <> 22 then
    raise exception 'The demo accounts are missing; run this file through pnpm demo:seed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles, roles and preferences
-- ---------------------------------------------------------------------------

update public.profiles p set
  bio = v.bio, fitness_level = v.level::public.fitness_level, primary_need = v.need::public.primary_need,
  onboarded_at = now() - make_interval(days => v.joined), created_at = now() - make_interval(days => v.joined),
  approve_followers = v.approve, discoverable = true, profile_theme = v.theme, show_race_history = v.races
from (values
  (1, 'Sample runner. Training for my first half marathon; slow and steady at KBR before work.', 'regular', 'consistency', 240, false, 'sunrise', true),
  (2, 'Sample runner. Runs the Saturday lake loop for the Lakeside Striders.', 'regular', 'consistency', 400, false, 'lake', true),
  (3, 'Sample runner. Back to running after two years off. Walk breaks welcome.', 'returning', 'both', 120, true, 'classic', false),
  (4, 'Sample runner. Track on Wednesdays, long runs on Sundays.', 'regular', 'schedule_conflicts', 500, false, 'night', true),
  (5, 'Sample runner. Week by week through Couch to 5K.', 'new_to_running', 'consistency', 30, false, 'sunrise', false),
  (6, 'Sample runner. Sunday long runs around Hussain Sagar.', 'regular', 'consistency', 450, false, 'lake', true),
  (7, 'Sample runner. Leads the women''s morning group at Durgam Cheruvu.', 'regular', 'both', 300, false, 'sunrise', false),
  (8, 'Sample runner. Fits runs around a HITEC City workday.', 'regular', 'schedule_conflicts', 200, false, 'classic', false),
  (9, 'Sample runner. Returning after a calf injury, following the return-to-running plan.', 'returning', 'both', 60, false, 'classic', false),
  (10, 'Sample runner. Student; intervals at the Bachupally track.', 'regular', 'schedule_conflicts', 150, false, 'night', false),
  (11, 'Sample runner. Half marathon in the winter, tempo runs in between.', 'regular', 'consistency', 260, false, 'lake', true),
  (12, 'Sample runner. Fifty-two and still enjoying every kilometre.', 'regular', 'consistency', 380, false, 'classic', true),
  (13, 'Sample runner. Trails when I can, the Bachupally track when I can''t.', 'regular', 'schedule_conflicts', 180, false, 'night', false),
  (14, 'Sample runner. Brisk walks for now, walk-runs soon.', 'new_to_running', 'consistency', 21, false, 'classic', false),
  (15, 'Sample runner. Early runs, then breakfast with the squad.', 'regular', 'consistency', 220, false, 'sunrise', false),
  (16, 'Sample runner. Chasing a sub-50 10K.', 'regular', 'consistency', 330, false, 'night', true),
  (17, 'Sample coach profile for local demo data.', 'regular', 'consistency', 500, false, 'classic', false),
  (18, 'Sample physiotherapist profile for local demo data.', 'regular', 'consistency', 500, false, 'classic', false),
  (19, 'Sample strength coach profile for local demo data.', 'regular', 'consistency', 500, false, 'classic', false),
  (20, 'Sample nutritionist profile for local demo data.', 'regular', 'consistency', 500, false, 'classic', false),
  (21, 'Sample run captain for local demo data.', 'regular', 'consistency', 420, false, 'classic', false),
  (22, 'Sample programme team account for local demo data.', 'regular', 'consistency', 500, false, 'classic', false)
) as v (n, bio, level, need, joined, approve, theme, races)
where p.id = pg_temp.p(v.n);

insert into public.user_roles (user_id, role, granted_by)
select pg_temp.p(v.n), v.role::public.app_role, pg_temp.p(22)
from (values (17, 'coach'), (18, 'coach'), (19, 'coach'), (20, 'coach'), (21, 'coach'),
             (22, 'programme_manager'), (22, 'admin')) as v (n, role)
on conflict do nothing;

insert into public.user_preferences (user_id, goal, preferred_days, preferred_times_of_day, sessions_per_week,
  max_session_minutes, preferred_activities, preferred_location_ids, reminders_enabled)
select pg_temp.p(v.n), v.goal::public.fitness_goal, v.days::smallint[], v.times::public.time_of_day[], v.per_week, v.max_min,
       v.acts::text[], v.locs::uuid[], false
from (values
  (1, 'run_without_stopping', '{2,4,6,7}', '{early_morning}', 4, 120, '{run,strength,mobility}', '{5eed0001-0000-4000-8000-000000000001,5eed0001-0000-4000-8000-000000000004}'),
  (2, 'run_without_stopping', '{1,3,5,6}', '{early_morning}', 4, 90, '{run}', '{5eed0001-0000-4000-8000-000000000004}'),
  (3, 'return_after_break', '{2,4,7}', '{early_morning}', 3, 45, '{walk_run,run}', '{5eed0001-0000-4000-8000-000000000001}'),
  (4, 'run_without_stopping', '{2,3,5,7}', '{early_morning,evening}', 5, 150, '{run,strength}', '{5eed0001-0000-4000-8000-000000000006}'),
  (5, 'first_5k', '{1,3,5}', '{morning}', 3, 40, '{walk_run}', '{5eed0001-0000-4000-8000-000000000001}'),
  (6, 'run_without_stopping', '{3,5,7}', '{early_morning}', 3, 150, '{run}', '{5eed0001-0000-4000-8000-000000000002}'),
  (7, 'build_habit', '{2,6}', '{early_morning}', 3, 60, '{run,mobility}', '{5eed0001-0000-4000-8000-000000000004}'),
  (8, 'build_habit', '{2,4,6}', '{early_morning}', 3, 60, '{run}', '{5eed0001-0000-4000-8000-000000000004}'),
  (9, 'return_after_break', '{1,3,5}', '{morning}', 3, 40, '{walk_run,strength}', '{5eed0001-0000-4000-8000-000000000001}'),
  (10, 'run_without_stopping', '{1,3,5}', '{evening}', 4, 75, '{run}', '{}'),
  (11, 'run_without_stopping', '{2,4,6}', '{early_morning}', 4, 120, '{run}', '{5eed0001-0000-4000-8000-000000000004}'),
  (12, 'build_habit', '{2,4,7}', '{early_morning}', 3, 90, '{run,walk}', '{5eed0001-0000-4000-8000-000000000002}'),
  (13, 'run_without_stopping', '{3,6}', '{early_morning}', 3, 90, '{run}', '{}'),
  (14, 'build_habit', '{1,3,6}', '{morning}', 3, 40, '{walk}', '{5eed0001-0000-4000-8000-000000000001}'),
  (15, 'build_habit', '{2,4,6}', '{early_morning}', 3, 75, '{run}', '{5eed0001-0000-4000-8000-000000000004}'),
  (16, 'run_without_stopping', '{2,3,5,7}', '{early_morning}', 4, 100, '{run}', '{5eed0001-0000-4000-8000-000000000006}'),
  (17, 'run_without_stopping', '{2,5}', '{early_morning}', 3, 90, '{run}', '{}'),
  (18, 'build_habit', '{}', '{}', 2, 60, '{}', '{}'),
  (19, 'get_stronger', '{}', '{}', 2, 60, '{strength}', '{}'),
  (20, 'build_habit', '{}', '{}', 2, 60, '{}', '{}'),
  (21, 'build_habit', '{2,7}', '{early_morning}', 3, 90, '{run}', '{}'),
  (22, 'build_habit', '{}', '{}', 1, 30, '{}', '{}')
) as v (n, goal, days, times, per_week, max_min, acts, locs)
on conflict (user_id) do nothing;

-- Meera's week: office hours, plus the early mornings she keeps for running.
insert into public.availability_blocks (user_id, weekday, start_time, end_time, kind, label)
select pg_temp.p(1), d, v.s::time, v.e::time, v.k::public.availability_kind, v.label
from generate_series(1, 5) d
cross join (values ('09:30', '18:30', 'busy', 'Work'), ('05:45', '07:15', 'free', 'Morning run window')) as v (s, e, k, label)
union all
select pg_temp.p(1), d, '06:00'::time, '09:00'::time, 'free'::public.availability_kind, 'Weekend long run'
from generate_series(6, 7) d;

-- ---------------------------------------------------------------------------
-- Clubs
-- ---------------------------------------------------------------------------

insert into public.clubs (id, slug, name, description, area, home_location_id, join_policy, created_by, created_at)
values
  (pg_temp.o(1, 1), 'lakeside-striders-sample', 'Lakeside Striders (sample)',
   'Sample club for local demo data. A friendly Madhapur club that runs the Durgam Cheruvu lake loop every Saturday morning, with pace groups from 5:00 to 7:30 min/km and a no-drop rule.',
   'Madhapur', '5eed0001-0000-4000-8000-000000000004', 'open', pg_temp.p(2), now() - interval '400 days'),
  (pg_temp.o(1, 2), 'hussain-sagar-harriers-sample', 'Hussain Sagar Harriers (sample)',
   'Sample club for local demo data. Sunday long runs along Necklace Road for runners building towards half and full marathons. New members join after a short chat with the captains.',
   'Necklace Road', '5eed0001-0000-4000-8000-000000000002', 'request', pg_temp.p(6), now() - interval '450 days'),
  (pg_temp.o(1, 3), 'gachibowli-track-club-sample', 'Gachibowli Track Club (sample)',
   'Sample club for local demo data. Midweek track sessions for runners who want to get faster. Check the venue''s entry rules before you go.',
   'Gachibowli', '5eed0001-0000-4000-8000-000000000006', 'request', pg_temp.p(4), now() - interval '500 days'),
  (pg_temp.o(1, 4), 'kbr-walk-runners-sample', 'KBR Walk-Runners (sample)',
   'Sample club for local demo data. A beginner-first group at KBR National Park: walk-run intervals, nobody left behind, and a stretch together at the end.',
   'Jubilee Hills', '5eed0001-0000-4000-8000-000000000001', 'open', pg_temp.p(3), now() - interval '110 days')
on conflict (id) do nothing;

insert into public.club_members (club_id, user_id, role, status, requested_at, joined_at, decided_by)
select pg_temp.o(1, v.c), pg_temp.p(v.n), v.role, v.status, now() - make_interval(days => v.ago),
       case when v.status = 'active' then now() - make_interval(days => v.ago) end,
       case when v.status = 'active' and v.role = 'member' then pg_temp.p(v.admin) end
from (values
  (1, 2, 'admin', 'active', 400, 2), (1, 7, 'captain', 'active', 300, 2), (1, 1, 'member', 'active', 230, 2),
  (1, 8, 'member', 'active', 190, 2), (1, 11, 'member', 'active', 250, 2), (1, 15, 'member', 'active', 210, 2),
  (1, 13, 'member', 'active', 160, 2), (1, 16, 'member', 'active', 320, 2), (1, 5, 'member', 'active', 25, 2),
  (2, 6, 'admin', 'active', 450, 6), (2, 12, 'captain', 'active', 370, 6), (2, 3, 'member', 'active', 100, 6),
  (2, 9, 'member', 'active', 55, 6), (2, 1, 'member', 'active', 90, 6), (2, 21, 'member', 'active', 300, 6),
  (2, 14, 'member', 'pending', 2, 6),
  (3, 4, 'admin', 'active', 500, 4), (3, 16, 'captain', 'active', 320, 4), (3, 10, 'member', 'active', 140, 4),
  (3, 8, 'member', 'active', 120, 4), (3, 15, 'member', 'active', 100, 4), (3, 13, 'member', 'active', 170, 4),
  (3, 17, 'member', 'active', 480, 4), (3, 2, 'member', 'pending', 1, 4),
  (4, 3, 'admin', 'active', 110, 3), (4, 21, 'captain', 'active', 100, 3), (4, 5, 'member', 'active', 28, 3),
  (4, 14, 'member', 'active', 20, 3), (4, 9, 'member', 'active', 50, 3), (4, 12, 'member', 'active', 90, 3)
) as v (c, n, role, status, ago, admin)
on conflict do nothing;

insert into public.club_announcements (id, club_id, author_id, title, body, created_at)
values
  (pg_temp.o(15, 1), pg_temp.o(1, 1), pg_temp.p(2), 'Saturday loop: new 7:00–7:30 pace group',
   'Lakshmi will lead a 7:00–7:30 min/km group from this Saturday. If you''re coming back from a break, this is the group for you. Meet at the main gate at 5:50.', now() - interval '6 days'),
  (pg_temp.o(15, 2), pg_temp.o(1, 1), pg_temp.p(7), 'Bring water: it''s still warm',
   'Mornings are pleasant but it warms up quickly after 7. Carry a bottle for the second lap and slow down if it feels hot.', now() - interval '2 days'),
  (pg_temp.o(15, 3), pg_temp.o(1, 2), pg_temp.p(6), 'Half marathon training block starts',
   'Our Sunday long runs build from 14 to 21 km over the next six weeks, ahead of the community half marathon on Necklace Road. Run at conversation pace; the long run is not a race.', now() - interval '9 days'),
  (pg_temp.o(15, 4), pg_temp.o(1, 3), pg_temp.p(4), 'Wednesday session: 6 × 800 m',
   'This week is 6 × 800 m with 2 minutes'' easy jog. Aim for the same time on every rep, not the fastest first one.', now() - interval '1 day'),
  (pg_temp.o(15, 5), pg_temp.o(1, 4), pg_temp.p(3), 'Welcome to our newest walk-runners',
   'A warm welcome to everyone who joined this month. Tuesday sessions are 1 minute running, 2 minutes walking, repeated. Comfortable shoes and water are all you need.', now() - interval '5 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Weekly group runs: four past weeks with check-ins, four weeks ahead
-- ---------------------------------------------------------------------------

insert into public.group_run_series (id, club_id, title, description, location_id, meeting_point, weekday, start_time,
  duration_minutes, capacity, beginner_friendly, no_drop, pace_groups, created_by, created_at)
values
  (pg_temp.o(2, 1), pg_temp.o(1, 1), 'Sample: Saturday lake loop',
   'Two laps of the Durgam Cheruvu lake path in pace groups, then a stretch together. Sample community content for local demo data.',
   '5eed0001-0000-4000-8000-000000000004', 'Main gate, Durgam Cheruvu lake park', 6, '06:00', 90, 50, false, true,
   default, pg_temp.p(2), now() - interval '300 days'),
  (pg_temp.o(2, 2), pg_temp.o(1, 2), 'Sample: Sunday Necklace Road long run',
   'An out-and-back long run along Necklace Road at conversation pace. Distances change through the training block. Sample community content for local demo data.',
   '5eed0001-0000-4000-8000-000000000002', 'People''s Plaza entrance', 7, '05:45', 150, 40, false, true,
   '[{"label": "5:30–6:00", "min_pace_seconds": 330, "max_pace_seconds": 360}, {"label": "6:00–6:45", "min_pace_seconds": 360, "max_pace_seconds": 405}, {"label": "6:45–7:30", "min_pace_seconds": 405, "max_pace_seconds": 450}]',
   pg_temp.p(6), now() - interval '400 days'),
  (pg_temp.o(2, 3), pg_temp.o(1, 3), 'Sample: Wednesday track session',
   'Warm-up laps, a main set of repeats and a cool-down. The session is posted in the club announcements each week. Sample community content for local demo data.',
   '5eed0001-0000-4000-8000-000000000006', 'Track entrance', 3, '18:00', 75, 30, false, false,
   '[{"label": "Faster group", "min_pace_seconds": 240, "max_pace_seconds": 300}, {"label": "Steady group", "min_pace_seconds": 300, "max_pace_seconds": 360}]',
   pg_temp.p(4), now() - interval '450 days'),
  (pg_temp.o(2, 4), pg_temp.o(1, 4), 'Sample: Tuesday beginners'' walk-run',
   'One minute running, two minutes walking, repeated for half an hour. Everyone finishes together. Sample community content for local demo data.',
   '5eed0001-0000-4000-8000-000000000001', 'Main entrance, KBR National Park', 2, '06:15', 60, 30, true, true,
   '[{"label": "Run-walk", "run_walk": true}, {"label": "Easy jog 7:00–8:00", "min_pace_seconds": 420, "max_pace_seconds": 480}]',
   pg_temp.p(3), now() - interval '100 days')
on conflict (id) do nothing;

-- Past runs: event ids o(3, 100 + 10 * series + weeks_ago).
insert into public.events (id, title, description, starts_at, ends_at, location_id, capacity, status, created_by,
  category, meeting_point, club_id, series_id, created_at)
select pg_temp.o(3, 100 + 10 * s.n + w), g.title, g.description,
       pg_temp.at(pg_temp.past_dow(g.weekday, w), g.start_time),
       pg_temp.at(pg_temp.past_dow(g.weekday, w), g.start_time) + make_interval(mins => g.duration_minutes),
       g.location_id, g.capacity, 'published', g.created_by,
       case when g.beginner_friendly then 'beginner' else 'group_run' end, g.meeting_point, g.club_id, g.id,
       pg_temp.at(pg_temp.past_dow(g.weekday, w), g.start_time) - interval '10 days'
from generate_series(1, 4) s (n)
join public.group_run_series g on g.id = pg_temp.o(2, s.n)
cross join generate_series(1, 4) w
on conflict do nothing;

-- Who came: most members most weeks, deterministically.
do $$
declare
  rec record;
  roster int[];
  going uuid[];
  checked uuid[];
  i int;
begin
  for rec in select s.n, w from generate_series(1, 4) s (n) cross join generate_series(1, 4) w loop
    roster := case rec.n
      when 1 then array[2, 7, 1, 8, 11, 15, 13, 16, 5]
      when 2 then array[6, 12, 3, 9, 1, 21]
      when 3 then array[4, 16, 10, 8, 15, 13, 17]
      else array[3, 21, 5, 14, 9, 12] end;
    going := '{}';
    checked := '{}';
    for i in 1 .. array_length(roster, 1) loop
      -- Leaders always come; others skip about one week in three, and Priya
      -- only started coming to the Tuesday group recently.
      continue when i > 2 and (roster[i] * 7 + rec.w * 3) % 3 = 0;
      continue when roster[i] = 5 and rec.n = 1;
      going := going || pg_temp.p(roster[i]);
      if not (i > 2 and (roster[i] + rec.w) % 7 = 0) then
        checked := checked || pg_temp.p(roster[i]);
      end if;
    end loop;
    perform pg_temp.attend_past(pg_temp.o(3, 100 + 10 * rec.n + rec.w), going, checked);
  end loop;
end $$;

-- Upcoming runs come from the real scheduler, run as each club's admin.
do $$
declare v record;
begin
  for v in select * from (values (1, 2), (2, 6), (3, 4), (4, 3)) as x (s, admin) loop
    perform pg_temp.act_as(pg_temp.p(v.admin));
    perform public.schedule_series_runs(pg_temp.o(2, v.s), 4);
  end loop;
  perform pg_temp.act_as(null);
end $$;

-- RSVPs for the next run of each series.
insert into public.event_rsvps (event_id, user_id, status)
select e.id, pg_temp.p(v.n), 'going'
from (values (1, 2), (1, 7), (1, 1), (1, 11), (1, 15), (1, 8), (2, 6), (2, 12), (2, 1), (2, 3), (2, 21),
             (3, 4), (3, 16), (3, 10), (3, 13), (4, 3), (4, 21), (4, 5), (4, 14), (4, 9)) as v (s, n)
join lateral (select id from public.events where series_id = pg_temp.o(2, v.s) and starts_at > now()
              order by starts_at limit 1) e on true
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- One-off events
-- ---------------------------------------------------------------------------

insert into public.events (id, title, description, starts_at, ends_at, location_id, capacity, status, created_by,
  category, meeting_point, registration_closes_at, route_id, club_id, created_at)
values
  (pg_temp.o(3, 1), 'Sample: KBR 10K time trial',
   'Five out-and-back laps of the KBR Park Nature Trail, timed. Run your own pace; results are for your own records. Sample community content for local demo data: this is not an officially organised event.',
   pg_temp.at(-24, '06:00'), pg_temp.at(-24, '07:45'), '5eed0001-0000-4000-8000-000000000001', 40, 'published', pg_temp.p(22),
   'race', 'Main entrance, KBR National Park', null, '5eed0005-0000-4000-8000-000000000001', null, now() - interval '40 days'),
  (pg_temp.o(3, 2), 'Sample: Necklace Road community half marathon',
   'A community half marathon on Necklace Road with pace groups from 1:55 to 2:25 and a run-walk group. Water every 3 km. Sample community content for local demo data: this is not an officially organised event.',
   pg_temp.at(46, '05:30'), pg_temp.at(46, '08:45'), '5eed0001-0000-4000-8000-000000000002', 150, 'published', pg_temp.p(22),
   'race', 'People''s Plaza entrance', pg_temp.at(40, '20:00'), null, null, now() - interval '20 days'),
  (pg_temp.o(3, 3), 'Sample: Running form and drills workshop',
   'Ninety minutes on posture, cadence and simple drills you can do before any run. Bring water; no running experience needed. Sample community content for local demo data.',
   pg_temp.at(9, '07:00'), pg_temp.at(9, '08:30'), '5eed0001-0000-4000-8000-000000000005', 25, 'published', pg_temp.p(17),
   'workshop', 'Near the main gate', null, null, null, now() - interval '8 days'),
  (pg_temp.o(3, 4), 'Sample: Stretch and chat after the lake loop',
   'Stay on after the Saturday lake loop for a guided stretch and a chat about the winter races. Sample community content for local demo data.',
   pg_temp.at(pg_temp.next_dow(6), '07:30'), pg_temp.at(pg_temp.next_dow(6), '08:15'), '5eed0001-0000-4000-8000-000000000004', 40, 'published', pg_temp.p(2),
   'social', 'Lawn by the main gate', null, null, pg_temp.o(1, 1), now() - interval '4 days'),
  (pg_temp.o(3, 5), 'Sample: First 5K walk-run morning',
   'A gentle 5K for anyone finishing Couch to 5K or starting out: run, walk or mix both. Captains run at the back so nobody finishes alone. Sample community content for local demo data.',
   pg_temp.at(12, '06:30'), pg_temp.at(12, '07:45'), '5eed0001-0000-4000-8000-000000000001', 40, 'published', pg_temp.p(22),
   'beginner', 'Main entrance, KBR National Park', null, '5eed0005-0000-4000-8000-000000000001', null, now() - interval '6 days')
on conflict (id) do nothing;

insert into public.event_team (event_id, user_id, role, added_by, task)
select pg_temp.o(3, v.e), pg_temp.p(v.n), v.role, pg_temp.p(22), v.task
from (values
  (1, 22, 'organiser', null), (1, 21, 'captain', 'Start and finish timing'), (1, 3, 'sweeper', 'Last runner on every lap'),
  (2, 6, 'organiser', null), (2, 2, 'captain', 'Pace group 1:55'), (2, 7, 'captain', 'Pace group 2:25'),
  (2, 12, 'sweeper', 'Behind the last runner'), (2, 21, 'volunteer', 'Water station at 10 km'),
  (3, 17, 'organiser', null),
  (5, 21, 'captain', 'Runs at the back'), (5, 3, 'sweeper', null)
) as v (e, n, role, task)
on conflict do nothing;

insert into public.event_pace_groups (id, event_id, label, min_pace_seconds, max_pace_seconds, run_walk, notes, sort_order, leader_id)
values
  (pg_temp.o(14, 1), pg_temp.o(3, 2), '1:55 finish', 320, 335, false, 'Even pace from the start.', 0, pg_temp.p(2)),
  (pg_temp.o(14, 2), pg_temp.o(3, 2), '2:10 finish', 360, 375, false, null, 1, null),
  (pg_temp.o(14, 3), pg_temp.o(3, 2), '2:25 finish', 405, 420, false, 'Walk through the water stations.', 2, pg_temp.p(7)),
  (pg_temp.o(14, 4), pg_temp.o(3, 2), 'Run-walk', null, null, true, '4 minutes running, 1 minute walking.', 3, null)
on conflict (id) do nothing;

insert into public.event_rsvps (event_id, user_id, status, pace_group_id)
select pg_temp.o(3, v.e), pg_temp.p(v.n), 'going', case when v.g > 0 then pg_temp.o(14, v.g) end
from (values
  (2, 1, 2), (2, 11, 2), (2, 15, 2), (2, 8, 1), (2, 13, 2), (2, 2, 1), (2, 7, 3), (2, 12, 3), (2, 16, 1),
  (2, 10, 1), (2, 4, 0), (2, 6, 0), (2, 21, 0),
  (3, 1, 0), (3, 5, 0), (3, 3, 0), (3, 14, 0), (3, 9, 0), (3, 11, 0),
  (4, 2, 0), (4, 7, 0), (4, 1, 0), (4, 15, 0),
  (5, 5, 0), (5, 14, 0), (5, 9, 0), (5, 12, 0), (5, 21, 0), (5, 3, 0)
) as v (e, n, g)
on conflict do nothing;

-- The time trial happened 24 days ago; results are added in stage B from the runners' GPS files.
select pg_temp.attend_past(pg_temp.o(3, 1),
  array[pg_temp.p(1), pg_temp.p(2), pg_temp.p(4), pg_temp.p(11), pg_temp.p(16), pg_temp.p(6), pg_temp.p(21), pg_temp.p(3)],
  array[pg_temp.p(1), pg_temp.p(2), pg_temp.p(4), pg_temp.p(11), pg_temp.p(16), pg_temp.p(6), pg_temp.p(21), pg_temp.p(3)]);

insert into public.event_updates (id, event_id, author_id, body, created_at)
values
  (pg_temp.o(22, 1), pg_temp.o(3, 2), pg_temp.p(6), 'Water stations will be at 3, 6, 10, 13 and 17 km. Pace group leaders will carry flags.', now() - interval '3 days'),
  (pg_temp.o(22, 2), pg_temp.o(3, 2), pg_temp.p(6), 'Bag drop opens at 5:00 by the People''s Plaza entrance. Please arrive by 5:15.', now() - interval '1 day'),
  (pg_temp.o(22, 3), pg_temp.o(3, 1), pg_temp.p(22), 'Thank you all for coming out! Results are in. Remember they''re for your own records.', pg_temp.at(-24, '09:00'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Squads
-- ---------------------------------------------------------------------------

insert into public.squads (id, name, description, weekly_km_target, join_policy, max_members, created_by, created_at)
values
  (pg_temp.o(4, 1), 'Sunrise Six (sample)', 'Sample squad. Madhapur early risers: two runs together a week and a shared weekly target.', 100, 'request', 8, pg_temp.p(1), now() - interval '70 days'),
  (pg_temp.o(4, 2), 'Necklace Road Long Runners (sample)', 'Sample squad. Sunday long runs and the odd midweek recovery jog.', 60, 'invite_only', 6, pg_temp.p(6), now() - interval '120 days'),
  (pg_temp.o(4, 3), 'Wednesday Track Crew (sample)', 'Sample squad. We meet after the track session to plan the week.', 90, 'request', 6, pg_temp.p(4), now() - interval '90 days')
on conflict (id) do nothing;

insert into public.squad_members (squad_id, user_id, role, status, invited_by, joined_at, created_at)
select pg_temp.o(4, v.s), pg_temp.p(v.n), v.role, v.status, case when v.status = 'invited' then pg_temp.p(v.cap) end,
       case when v.status = 'active' then now() - make_interval(days => v.ago) end, now() - make_interval(days => v.ago)
from (values
  (1, 1, 'captain', 'active', 70, 1), (1, 7, 'member', 'active', 68, 1), (1, 11, 'member', 'active', 60, 1),
  (1, 15, 'member', 'active', 50, 1), (1, 8, 'member', 'active', 45, 1), (1, 13, 'member', 'active', 30, 1),
  (2, 6, 'captain', 'active', 120, 6), (2, 12, 'member', 'active', 110, 6), (2, 9, 'member', 'active', 40, 6),
  (2, 3, 'member', 'active', 35, 6), (2, 14, 'member', 'invited', 1, 6),
  (3, 4, 'captain', 'active', 90, 4), (3, 16, 'member', 'active', 85, 4), (3, 10, 'member', 'active', 60, 4),
  (3, 2, 'member', 'requested', 1, 4)
) as v (s, n, role, status, ago, cap)
on conflict do nothing;

do $$
declare
  m record;
begin
  for m in select * from (values
    (1, 1, 1, 'Morning all! Thursday tempo at KBR is on. 6:00 at the gate.', 50),
    (2, 1, 7, 'I''m in. Can someone hold 6:15s with me on the second loop?', 49),
    (3, 1, 11, 'Count me in, I''ll run the 6:15s with you.', 48),
    (4, 1, 15, 'We hit 104 km as a squad last week, first time over target!', 30),
    (5, 1, 8, 'Late meeting tomorrow, I''ll do my run in the evening instead.', 20),
    (6, 1, 13, 'Bachupally track was quiet this morning. Recommend it for intervals.', 6),
    (7, 1, 1, 'Long run on Sunday: 16 km at easy pace. Coffee after?', 2),
    (8, 2, 6, 'Sunday: 18 km out and back. Start at 5:45 sharp so we finish before the heat.', 4),
    (9, 2, 12, 'See you there. I''ll bring extra water.', 3),
    (10, 2, 9, 'I''ll join for the first 5 km and walk back. Still building up.', 3),
    (11, 3, 4, 'This week: 6 × 800 m. Same time on every rep.', 2),
    (12, 3, 16, 'Last week''s 400s felt great. Ready.', 1)
  ) as v (i, s, n, body, days_ago)
  loop
    perform pg_temp.act_as(pg_temp.p(m.n));
    insert into public.squad_messages (id, squad_id, author_id, body, created_at)
    values (pg_temp.o(16, m.i), pg_temp.o(4, m.s), pg_temp.p(m.n), m.body, now())
    on conflict (id) do nothing;
    -- The insert trigger stamps messages with now(); give them their place in the conversation.
    update public.squad_messages set created_at = now() - make_interval(days => m.days_ago, hours => 12 - m.i)
     where id = pg_temp.o(16, m.i);
  end loop;
  perform pg_temp.act_as(null);
end $$;

select pg_temp.act_as(pg_temp.p(1));
insert into public.squad_runs (id, squad_id, title, starts_at, meeting_point, location_id, route_id, notes)
values (pg_temp.o(5, 1), pg_temp.o(4, 1), 'Thursday tempo at KBR', pg_temp.at(pg_temp.next_dow(4), '06:00'),
        'Main entrance, KBR National Park', '5eed0001-0000-4000-8000-000000000001', '5eed0005-0000-4000-8000-000000000001',
        '2 km easy, 4 km at tempo effort, 2 km easy.')
on conflict (id) do nothing;
insert into public.squad_relays (id, squad_id, journey, starts_on, created_by)
values (pg_temp.o(4, 101), pg_temp.o(4, 1), 'hyd_vizag', pg_temp.day(-21), pg_temp.p(1))
on conflict (id) do nothing;
select pg_temp.act_as(pg_temp.p(6));
insert into public.squad_runs (id, squad_id, title, starts_at, meeting_point, location_id, notes)
values (pg_temp.o(5, 2), pg_temp.o(4, 2), 'Recovery jog and breakfast', pg_temp.at(pg_temp.next_dow(3), '06:00'),
        'People''s Plaza entrance', '5eed0001-0000-4000-8000-000000000002', 'Very easy 6 km. Walkers welcome.')
on conflict (id) do nothing;
select pg_temp.act_as(null);

insert into public.squad_run_attendance (run_id, user_id, status)
select pg_temp.o(5, v.r), pg_temp.p(v.n), v.status
from (values (1, 1, 'going'), (1, 7, 'going'), (1, 11, 'going'), (1, 15, 'going'), (1, 8, 'not_going'),
             (2, 6, 'going'), (2, 12, 'going'), (2, 9, 'going')) as v (r, n, status)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Leagues
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.p(2));
insert into public.leagues (id, name, kind, description, starts_on, ends_on, status, team_size_max)
values (pg_temp.o(6, 1), 'Hyderabad Club League: Winter (sample)', 'club',
        'Sample league for local demo data. Clubs score for active days, consistent weeks, group runs, distance (capped per day), challenges and events. Points reward turning up, not speed.',
        pg_temp.day(-20), pg_temp.day(41), 'active', 50)
on conflict (id) do nothing;
select pg_temp.act_as(pg_temp.p(22));
insert into public.leagues (id, name, kind, description, starts_on, ends_on, status, team_size_max, scoring)
values (pg_temp.o(6, 2), 'Consistency league: one month (sample)', 'consistency',
        'Sample league for local demo data. Only showing up counts here: active days and weeks with three or more of them.',
        pg_temp.day(-9), pg_temp.day(20), 'active', 20,
        '{"active_day": 10, "consistent_week": 25, "group_run": 10, "per_5km": 0, "challenge": 0, "event": 0}')
on conflict (id) do nothing;
-- Leagues start as drafts; their organisers open them, as they would in the app.
update public.leagues set status = 'active' where id = pg_temp.o(6, 2) and status = 'draft';
select pg_temp.act_as(pg_temp.p(2));
update public.leagues set status = 'active' where id = pg_temp.o(6, 1) and status = 'draft';
select pg_temp.act_as(null);

insert into public.league_teams (id, league_id, name, affiliation, club_id, join_code)
values
  (pg_temp.o(7, 1), pg_temp.o(6, 1), 'Lakeside Striders', 'club', pg_temp.o(1, 1), null),
  (pg_temp.o(7, 2), pg_temp.o(6, 1), 'Hussain Sagar Harriers', 'club', pg_temp.o(1, 2), null),
  (pg_temp.o(7, 3), pg_temp.o(6, 1), 'Gachibowli Track Club', 'club', pg_temp.o(1, 3), null),
  (pg_temp.o(7, 4), pg_temp.o(6, 2), 'Early Birds', 'custom', null, 'EARLYBIRDS'),
  (pg_temp.o(7, 5), pg_temp.o(6, 2), 'After Work Runners', 'custom', null, 'AFTERWORK')
on conflict (id) do nothing;

insert into public.league_members (league_id, team_id, user_id, joined_at)
select pg_temp.o(6, v.l), pg_temp.o(7, v.t), pg_temp.p(v.n), now() - make_interval(days => v.ago)
from (values
  (1, 1, 2, 20), (1, 1, 1, 19), (1, 1, 7, 19), (1, 1, 11, 18), (1, 1, 15, 15), (1, 1, 8, 12),
  (1, 2, 6, 20), (1, 2, 12, 20), (1, 2, 3, 17), (1, 2, 9, 10), (1, 2, 21, 16),
  (1, 3, 4, 20), (1, 3, 16, 20), (1, 3, 10, 18), (1, 3, 13, 14), (1, 3, 17, 13),
  (2, 4, 5, 9), (2, 4, 14, 8), (2, 4, 9, 9), (2, 4, 3, 7), (2, 4, 12, 6), (2, 4, 1, 9),
  (2, 5, 8, 9), (2, 5, 15, 8), (2, 5, 10, 7), (2, 5, 7, 5)
) as v (l, t, n, ago)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Challenges (progress and leaderboards are computed from activity)
-- ---------------------------------------------------------------------------

insert into public.challenges (id, title, description, scope, club_id, kind, goal, collective, workout_types,
  starts_at, ends_at, reward_xp, reward_coins, status, created_by, created_at)
values
  (pg_temp.o(8, 1), '100 km in 30 days (sample)', 'Sample challenge. Run or walk-run 100 km in 30 days. Distance counts up to 50 km a day.',
   'city', null, 'distance', 100000, false, '{run,walk_run}', pg_temp.at(-10, '00:00'), pg_temp.at(20, '00:00'), 100, 10, 'active', pg_temp.p(22), now() - interval '12 days'),
  (pg_temp.o(8, 2), 'Early bird: 8 runs before 7:30 (sample)', 'Sample challenge. Eight days with a run, walk-run or walk that starts between 5:00 and 7:30.',
   'city', null, 'early_runs', 8, false, '{run,walk_run,walk}', pg_temp.at(-10, '00:00'), pg_temp.at(20, '00:00'), 60, 5, 'active', pg_temp.p(22), now() - interval '12 days'),
  (pg_temp.o(8, 3), 'Hyderabad to Kanyakumari together (sample)', 'Sample challenge. Together, cover about 1,500 km, roughly the road distance from Hyderabad to Kanyakumari. Every participant''s distance counts.',
   'city', null, 'distance', 1500000, true, '{run,walk_run,walk}', pg_temp.at(-14, '00:00'), pg_temp.at(30, '00:00'), 50, 0, 'active', pg_temp.p(22), now() - interval '15 days'),
  (pg_temp.o(8, 4), 'Four Saturday lake loops (sample)', 'Sample club challenge. Check in at four Saturday lake loops.',
   'club', pg_temp.o(1, 1), 'group_runs', 4, false, '{run,walk_run}', pg_temp.at(-29, '00:00'), pg_temp.at(14, '00:00'), 50, 0, 'active', pg_temp.p(2), now() - interval '30 days'),
  (pg_temp.o(8, 5), 'Active 12 days this month (sample)', 'Sample challenge. Twelve days with at least ten minutes of running, walking or strength work.',
   'city', null, 'active_days', 12, false, '{run,walk_run,walk,strength,mobility}', pg_temp.at(-9, '00:00'), pg_temp.at(21, '00:00'), 80, 5, 'active', pg_temp.p(22), now() - interval '10 days')
on conflict (id) do nothing;

insert into public.challenge_participants (challenge_id, user_id, joined_at)
select pg_temp.o(8, c), pg_temp.p(n), now() - interval '9 days'
from (values (1, array[1, 2, 4, 6, 10, 11, 16, 13, 15, 8, 17]),
             (2, array[1, 2, 3, 7, 11, 12, 15, 21, 5, 14]),
             (3, array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 21]),
             (4, array[1, 2, 7, 11, 15, 8, 16]),
             (5, array[1, 3, 5, 9, 12, 14, 7, 8])) as v (c, people)
cross join unnest(v.people) n
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Follows and partner matching
-- ---------------------------------------------------------------------------

insert into public.follows (follower_id, followee_id)
select pg_temp.p(a), pg_temp.p(b)
from (values
  (1, 2), (1, 7), (1, 11), (1, 15), (1, 4), (1, 6), (1, 17), (1, 3), (1, 13),
  (2, 1), (7, 1), (11, 1), (15, 1), (8, 1), (13, 1), (5, 1), (17, 1), (6, 1), (12, 1),
  (2, 4), (4, 2), (4, 16), (16, 4), (10, 4), (10, 16), (6, 12), (12, 6), (3, 6), (9, 3), (5, 3), (14, 3),
  (11, 15), (15, 11), (8, 2), (7, 2), (13, 10), (21, 6), (3, 21), (16, 2), (9, 17)
) as v (a, b)
on conflict do nothing;
-- Sana approves her followers by hand: she has accepted everyone except
-- Farhan, whose request is still waiting.
update public.follows set status = 'accepted', accepted_at = now() - interval '5 days'
 where followee_id = pg_temp.p(3) and status = 'pending';
insert into public.follows (follower_id, followee_id) values (pg_temp.p(10), pg_temp.p(3)) on conflict do nothing;

insert into public.matching_profiles (user_id, opted_in, pace_min_s, pace_max_s, typical_km, areas, days, times, goals, experience, group_size, intro)
select pg_temp.p(v.n), true, v.pmin, v.pmax, v.km, v.areas::text[], v.days::smallint[], v.times::public.time_of_day[], v.goals::text[],
       v.lvl::public.fitness_level, v.size, v.intro
from (values
  (1, 390, 420, 8, '{madhapur_hitec_city,jubilee_hills}', '{2,4,7}', '{early_morning}', '{race,consistency}', 'regular', 'small_group', 'Easy long runs on Sundays; half marathon in the winter.'),
  (3, 420, 480, 4, '{jubilee_hills,banjara_hills}', '{2,4}', '{early_morning}', '{beginner_friendly,social}', 'returning', 'partner', 'Coming back after a break. Walk breaks welcome.'),
  (5, 450, 540, 3, '{jubilee_hills,kondapur}', '{1,3,5}', '{morning}', '{beginner_friendly,consistency}', 'new_to_running', 'partner', 'Halfway through Couch to 5K. Looking for company at my pace.'),
  (7, 390, 420, 6, '{madhapur_hitec_city}', '{2,6}', '{early_morning}', '{social,consistency}', 'regular', 'small_group', 'Saturday lake loop regular.'),
  (8, 345, 375, 7, '{madhapur_hitec_city,gachibowli}', '{2,4,6}', '{early_morning,evening}', '{faster,consistency}', 'regular', 'any', 'Running before work in HITEC City.'),
  (9, 450, 540, 3, '{jubilee_hills,banjara_hills}', '{1,3,5}', '{morning}', '{beginner_friendly}', 'returning', 'partner', 'Returning from a calf injury, easy pace only.'),
  (10, 315, 345, 8, '{miyapur,kukatpally}', '{1,3,5}', '{evening}', '{faster,race}', 'regular', 'small_group', 'Intervals at the Bachupally track.'),
  (11, 375, 405, 9, '{madhapur_hitec_city,kondapur}', '{2,4,6}', '{early_morning}', '{race,longer}', 'regular', 'small_group', 'Building to a half marathon. Happy to share long runs.'),
  (12, 405, 450, 7, '{necklace_road,secunderabad}', '{2,4,7}', '{early_morning}', '{consistency,social}', 'regular', 'any', 'Steady pace, good conversation.'),
  (13, 360, 390, 8, '{kukatpally,miyapur}', '{3,6}', '{early_morning}', '{longer,social}', 'regular', 'small_group', 'Trail runs on weekends when I can.'),
  (14, 480, 600, 3, '{jubilee_hills}', '{1,3,6}', '{morning}', '{beginner_friendly}', 'new_to_running', 'partner', 'Walking now, walk-running soon.'),
  (15, 360, 390, 7, '{madhapur_hitec_city,kondapur}', '{2,4,6}', '{early_morning}', '{social,race}', 'regular', 'small_group', 'Early runs, then breakfast.'),
  (16, 300, 330, 10, '{gachibowli,madhapur_hitec_city}', '{2,3,5,7}', '{early_morning}', '{faster,race}', 'regular', 'small_group', 'Chasing a sub-50 10K. Tempo partners welcome.'),
  (6, 360, 390, 14, '{necklace_road,begumpet}', '{3,5,7}', '{early_morning}', '{longer,race}', 'regular', 'small_group', 'Long runs around Hussain Sagar.')
) as v (n, pmin, pmax, km, areas, days, times, goals, lvl, size, intro)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Professionals: sample profiles, never verified, so never bookable
-- ---------------------------------------------------------------------------

insert into public.professional_profiles (user_id, profession, headline, bio, experience_years, specializations, credentials, listed)
values
  (pg_temp.p(17), 'running_coach', 'Sample profile: running coach for first 10Ks and half marathons',
   'Sample profile for local demo data. This is not a real coach and no qualifications are claimed. It shows how a coach''s profile, services and verification status appear.',
   8, '{first half marathon,returning runners,pacing}', '[]', true),
  (pg_temp.p(18), 'physiotherapist', 'Sample profile: sports physiotherapy for runners',
   'Sample profile for local demo data. This is not a real physiotherapist and no qualifications are claimed. A real physiotherapist''s registration is checked before their profile can be booked.',
   11, '{running injuries,return to running,calf and Achilles}', '[]', true),
  (pg_temp.p(19), 'strength_coach', 'Sample profile: strength training for runners',
   'Sample profile for local demo data. This is not a real strength coach and no qualifications are claimed.',
   6, '{strength for runners,mobility,injury prevention}', '[]', true),
  (pg_temp.p(20), 'nutritionist', 'Sample profile: everyday nutrition for runners',
   'Sample profile for local demo data. This is not a real nutritionist and no qualifications are claimed.',
   5, '{race-day fuelling,vegetarian athletes,hydration in heat}', '[]', true),
  (pg_temp.p(21), 'run_captain', 'Sample profile: run captain at KBR and Necklace Road',
   'Sample profile for local demo data. Runs at the back of beginner groups so nobody finishes alone.',
   4, '{beginner groups,pacing,run-walk}', '[]', true)
on conflict (user_id) do nothing;
-- Two have asked for review, so the manager's queue has work in it. None is verified.
update public.professional_profiles set verification_status = 'pending'
 where user_id in (pg_temp.p(17), pg_temp.p(18)) and verification_status = 'unverified';

insert into public.professional_services (id, professional_id, kind, title, description, duration_minutes, delivery, indicative_price_inr, active)
values
  (pg_temp.o(10, 1), pg_temp.p(17), 'training_consultation', 'Training plan review', 'We look at your recent weeks, your race goal and your schedule, and agree what to change.', 45, 'online', 1200, true),
  (pg_temp.o(10, 2), pg_temp.p(17), 'race_preparation', 'Half marathon race-week plan', 'Pacing, tapering and race-morning routine for your half marathon.', 30, 'online', 900, true),
  (pg_temp.o(10, 3), pg_temp.p(17), 'form_review', 'Running form review at KBR', 'Video and drills on a short loop; you get notes and two drills to practise.', 60, 'in_person', 1500, true),
  (pg_temp.o(10, 4), pg_temp.p(18), 'physiotherapy', 'Running injury assessment', 'Assessment of a running-related niggle and a plan to return to running.', 60, 'in_person', 1800, true),
  (pg_temp.o(10, 5), pg_temp.p(18), 'physiotherapy', 'Return-to-running follow-up', 'Progress check and plan update after an injury.', 30, 'in_person', 1000, true),
  (pg_temp.o(10, 6), pg_temp.p(19), 'strength_programme', 'Four-week strength block for runners', 'Two short sessions a week to support your running.', 45, 'online', 1500, true),
  (pg_temp.o(10, 7), pg_temp.p(19), 'mobility_session', 'Hips and ankles mobility session', 'A guided session you can repeat on your own.', 30, 'online', 600, true),
  (pg_temp.o(10, 8), pg_temp.p(20), 'training_consultation', 'Race-day fuelling plan', 'What to eat before and during a long run or race, in Hyderabad''s heat.', 45, 'online', 1100, true),
  (pg_temp.o(10, 9), pg_temp.p(21), 'training_consultation', 'First group run, one-to-one', 'Run your first group run with a captain beside you.', 45, 'in_person', 0, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Coaching: assignments, programmes, notes and messages
-- ---------------------------------------------------------------------------

insert into public.coach_assignments (coach_id, runner_id, assigned_by, created_at)
select pg_temp.p(17), pg_temp.p(n), pg_temp.p(22), now() - make_interval(days => ago)
from (values (1, 60), (5, 25), (9, 50), (3, 40)) as v (n, ago)
where not exists (select 1 from public.coach_assignments a where a.coach_id = pg_temp.p(17) and a.runner_id = pg_temp.p(v.n));

insert into public.enrollments (id, user_id, programme_id, started_at, coach_id)
select pg_temp.o(18, v.i), pg_temp.p(v.n), pr.id, pg_temp.at(-v.ago, '06:00'), pg_temp.p(17)
from (values (1, 5, 'couch-to-5k', 24), (2, 9, 'return-to-running', 33)) as v (i, n, slug, ago)
join public.programmes pr on pr.slug = v.slug
on conflict (id) do nothing;

insert into public.messages (id, sender_id, recipient_id, body, created_at)
values
  (pg_temp.o(17, 1), pg_temp.p(17), pg_temp.p(1), 'Great time trial last month. Shall we look at your half marathon plan this week?', now() - interval '6 days'),
  (pg_temp.o(17, 2), pg_temp.p(1), pg_temp.p(17), 'Yes please! Long runs are going well, tempo runs still feel hard.', now() - interval '6 days' + interval '2 hours'),
  (pg_temp.o(17, 3), pg_temp.p(17), pg_temp.p(1), 'That''s normal at this stage. Keep the tempo effort "comfortably hard", not a race. I''ve left a note on your plan.', now() - interval '5 days'),
  (pg_temp.o(17, 4), pg_temp.p(17), pg_temp.p(5), 'Well done on finishing week 3. Repeat a session if any felt too hard; there''s no rush.', now() - interval '3 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Announcements, place updates, route reviews and reports
-- ---------------------------------------------------------------------------

insert into public.announcements (id, author_id, audience, title, body, publish_at)
values
  (pg_temp.o(11, 1), pg_temp.p(22), 'everyone', 'Sample: Winter running starts now',
   'Mornings are cooler, which makes it a good time to build up. Increase your weekly distance gradually, keep most runs easy, and carry water: it still warms up quickly after sunrise. Sample announcement for local demo data.', now() - interval '8 days'),
  (pg_temp.o(11, 2), pg_temp.p(22), 'everyone', 'Sample: New beginner sessions at KBR',
   'The KBR Walk-Runners now meet every Tuesday at 6:15. Walk-run intervals, a captain at the back and a stretch at the end. Find it under Group runs. Sample announcement for local demo data.', now() - interval '3 days')
on conflict (id) do nothing;

insert into public.location_updates (id, location_id, author_id, title, body, publish_at)
values (pg_temp.o(23, 1), '5eed0001-0000-4000-8000-000000000004', pg_temp.p(22), 'Sample: Busy on weekend mornings',
        'The lake path gets crowded after 7:00 on weekends. Start early or run the second lap on the outer path. Sample update for local demo data.', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.route_reviews (route_id, user_id, rating, safety, shade, surface, crowd, comment, created_at)
select v.route::uuid, pg_temp.p(v.n), v.rating, v.safety, v.shade, v.surface, v.crowd, v.comment, now() - make_interval(days => v.ago)
from (values
  ('5eed0005-0000-4000-8000-000000000001', 1, 5, 5, 5, 4, 3, 'Shaded and calm early in the morning. Out-and-back laps make it easy to judge distance.', 20),
  ('5eed0005-0000-4000-8000-000000000001', 2, 4, 5, 5, 4, 2, 'Lovely trail, but busy after 7 on weekends.', 15),
  ('5eed0005-0000-4000-8000-000000000001', 3, 5, 5, 4, 4, 3, 'Perfect for walk-runs. Benches if you need a break.', 10),
  ('5eed0005-0000-4000-8000-000000000001', 16, 4, 4, 5, 3, 3, 'A few uneven patches; watch your footing on the turnaround.', 8),
  ('5eed0005-0000-4000-8000-000000000002', 10, 4, 4, 2, 4, 4, 'Short loop, great for intervals. Little shade, go early.', 12),
  ('5eed0005-0000-4000-8000-000000000002', 13, 4, 4, 2, 4, 5, 'Quiet on weekday mornings. Count laps for distance.', 5)
) as v (route, n, rating, safety, shade, surface, crowd, comment, ago)
on conflict do nothing;

insert into public.route_reports (route_id, reporter_id, kind, note, created_at, expires_at)
select '5eed0005-0000-4000-8000-000000000001', pg_temp.p(16), 'hazard',
       'Sample report: loose gravel on the path about 300 m from the start.', now() - interval '2 days', now() + interval '12 days'
where not exists (select 1 from public.route_reports where reporter_id = pg_temp.p(16));

-- ---------------------------------------------------------------------------
-- Meera's own records: race entries, recovery and strength
-- ---------------------------------------------------------------------------

insert into public.race_entries (id, user_id, event_id, name, race_date, distance, distance_m, city, status, target_seconds,
  bib, wave, checklist, travel_notes, find_partners, result_seconds, result_source, reflection, created_at)
values
  (pg_temp.o(9, 1), pg_temp.p(1), pg_temp.o(3, 2), 'Sample: Necklace Road community half marathon', pg_temp.day(46), 'half', 21097,
   'Hyderabad', 'registered', 7800, null, 'Wave B',
   '[{"id": "shoes", "label": "Race shoes broken in (3+ runs)", "done": true}, {"id": "kit", "label": "Kit laid out the night before", "done": false}, {"id": "gel", "label": "Practise fuelling on two long runs", "done": true}, {"id": "route", "label": "Check the route and water stations", "done": false}, {"id": "sleep", "label": "Early night before the race", "done": false}]',
   'Cab booked for 4:45. Breakfast: banana and toast at 4:15.', true, null, null, null, now() - interval '20 days'),
  (pg_temp.o(9, 3), pg_temp.p(1), null, 'Sample: Gachibowli Diwali 5K', pg_temp.day(-110), '5k', 5000,
   'Hyderabad', 'completed', null, '1452', null, '[]', null, false, 1830, 'self_reported',
   'First race! Started too fast and walked twice, but finished smiling.', now() - interval '130 days'),
  (pg_temp.o(9, 4), pg_temp.p(11), pg_temp.o(3, 2), 'Sample: Necklace Road community half marathon', pg_temp.day(46), 'half', 21097,
   'Hyderabad', 'registered', 7500, null, null, '[]', null, true, null, null, null, now() - interval '18 days'),
  (pg_temp.o(9, 5), pg_temp.p(15), pg_temp.o(3, 2), 'Sample: Necklace Road community half marathon', pg_temp.day(46), 'half', 21097,
   'Hyderabad', 'registered', 7700, null, null, '[]', null, true, null, null, null, now() - interval '12 days')
on conflict (id) do nothing;

insert into public.race_goals (id, user_id, distance, race_date, name, event_id, target_seconds, current_level, days_per_week, long_run_day)
values (pg_temp.o(19, 1), pg_temp.p(1), 'half', pg_temp.day(46), 'Sample: Necklace Road community half marathon',
        pg_temp.o(3, 2), 7800, 'regular', 4, 7)
on conflict (id) do nothing;

insert into public.recovery_entries (id, user_id, entry_date, sleep_quality, sleep_hours, fatigue, soreness, soreness_areas,
  stress, energy, workout_rpe, recovery_activities, notes, share_with_coach)
select pg_temp.o(20, d), pg_temp.p(1), pg_temp.day(-d),
       3 + (d % 3 = 0)::int - (d % 5 = 0)::int, 6.5 + (d % 4) * 0.5, 2 + (d % 4 = 1)::int + (d % 7 = 2)::int,
       1 + (d % 3 = 1)::int, case when d % 3 = 1 then '{calves}'::text[] else '{}' end,
       2 + (d % 5 = 3)::int, 3 + (d % 3 = 0)::int, 4 + (d % 4), case when d % 2 = 0 then '{stretching}'::text[] else '{foam_rolling,walk}' end,
       case d when 1 then 'Legs a bit heavy after the long run.' when 8 then 'Slept badly, took it easy.' end, true
from generate_series(1, 20) d
where d % 3 <> 2
on conflict (id) do nothing;

insert into public.strength_logs (id, user_id, performed_on, title, session_key, minutes, exercises, notes, created_at)
select pg_temp.o(21, i), pg_temp.p(v.n), pg_temp.day(-v.ago), v.title, v.key, v.minutes, v.ex::jsonb, null,
       pg_temp.at(-v.ago, '19:00')
from (values
  (1, 1, 2, 'Strength: runner foundation', 'runner_foundation', 25, '[{"key": "glute_bridge", "sets": 3, "reps": 12}, {"key": "clamshell", "sets": 2, "reps": 15}, {"key": "plank", "sets": 3, "seconds": 40}, {"key": "dead_bug", "sets": 2, "reps": 10}, {"key": "squat", "sets": 3, "reps": 12}, {"key": "calf_raise", "sets": 3, "reps": 15}]'),
  (2, 1, 9, 'Strength: single-leg stability', 'single_leg_stability', 30, '[{"key": "split_squat", "sets": 3, "reps": 8}, {"key": "single_leg_rdl", "sets": 3, "reps": 8}, {"key": "step_up", "sets": 2, "reps": 10}, {"key": "side_plank", "sets": 2, "seconds": 30}, {"key": "single_leg_calf_raise", "sets": 3, "reps": 12}]'),
  (3, 1, 16, 'Mobility reset', 'mobility_reset', 20, '[{"key": "hip_circles", "sets": 1, "reps": 10}, {"key": "worlds_greatest", "sets": 2, "reps": 5}, {"key": "cat_cow", "sets": 1, "reps": 10}, {"key": "calf_stretch", "sets": 2, "seconds": 30}]'),
  (4, 9, 3, 'Strength: hamstrings and calves', 'hamstrings_calves', 25, '[{"key": "single_leg_bridge", "sets": 3, "reps": 10}, {"key": "bent_knee_calf_raise", "sets": 3, "reps": 15}, {"key": "single_leg_calf_raise", "sets": 3, "reps": 10}, {"key": "bird_dog", "sets": 2, "reps": 10}]'),
  (5, 9, 10, 'Strength: runner foundation', 'runner_foundation', 25, '[{"key": "glute_bridge", "sets": 3, "reps": 12}, {"key": "plank", "sets": 3, "seconds": 30}, {"key": "calf_raise", "sets": 3, "reps": 15}]')
) as v (i, n, ago, title, key, minutes, ex)
on conflict (id) do nothing;

select pg_temp.act_as(null);
