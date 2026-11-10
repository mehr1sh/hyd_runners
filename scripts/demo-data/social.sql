-- HYD Runners local demo data, stage B: what happens around the activities.
-- LOCAL DEVELOPMENT ONLY; run by `pnpm demo:seed` after the GPS activities
-- have been imported. Same conventions as community.sql.

\set ON_ERROR_STOP on

create function pg_temp.o(kind int, n int) returns uuid language sql immutable as $$
  select format('de%s-0000-4000-8000-%s', lpad(kind::text, 6, '0'), lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$ select pg_temp.o(0, n) $$;
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true);
end $$;
-- A runner's most recent ready activity with this name.
create function pg_temp.act(n int, name text, nth int default 1) returns uuid language sql stable as $$
  select id from public.activities where user_id = pg_temp.p(n) and status = 'ready' and activities.name = act.name
  order by started_at desc offset nth - 1 limit 1
$$;

-- ---------------------------------------------------------------------------
-- Time-trial results, taken from each runner's GPS file
-- ---------------------------------------------------------------------------

insert into public.event_results (event_id, user_id, outcome, finish_seconds, distance_meters, recorded_by, recorded_at)
select pg_temp.o(3, 1), a.user_id, 'finished', a.elapsed_seconds, round(a.distance_m), pg_temp.p(21), a.ended_at + interval '20 minutes'
from public.activities a
join public.event_rsvps r on r.user_id = a.user_id and r.event_id = pg_temp.o(3, 1) and r.checked_in_at is not null
where a.name = 'KBR 10K time trial' and a.status = 'ready'
on conflict do nothing;

insert into public.race_entries (id, user_id, event_id, name, race_date, distance, distance_m, city, status, target_seconds,
  checklist, result_seconds, result_source, result_activity_id, reflection, created_at)
select pg_temp.o(9, 2), pg_temp.p(1), pg_temp.o(3, 1), 'Sample: KBR 10K time trial', (a.started_at at time zone 'Asia/Kolkata')::date,
       '10k', 10000, 'Hyderabad', 'completed', 3600, '[]', a.elapsed_seconds, 'imported_activity', a.id,
       'Held back for the first 5 km like Coach Sandeep suggested, and finished strong. A new 10K best.',
       a.started_at - interval '20 days'
from public.activities a where a.id = pg_temp.act(1, 'KBR 10K time trial')
on conflict (id) do nothing;

insert into public.activity_reflections (activity_id, user_id, difficult, enjoyed, ran_with, achieved, story, share_story)
select pg_temp.act(1, 'KBR 10K time trial'), pg_temp.p(1), 'The fourth lap. My legs wanted to stop at the turnaround.',
       'Everyone cheering at the start of each lap.', 'Kiran, Divya and the Saturday crew',
       'A 10K without walking, and faster in the second half.',
       'Six months ago I couldn''t run 2 km without stopping. Today I ran five laps of the KBR trail without a single walk break, and the second half was faster than the first. Next stop: the half marathon.',
       true
where pg_temp.act(1, 'KBR 10K time trial') is not null
on conflict do nothing;
insert into public.activity_reflections (activity_id, user_id, enjoyed, achieved, story, share_story)
select pg_temp.act(1, 'Sunday long run'), pg_temp.p(1), 'Cool air and an empty trail.', 'Longest run so far.',
       'Slow and steady: the longest run of my training block so far. Took water at every lap.', true
where pg_temp.act(1, 'Sunday long run') is not null
on conflict do nothing;

-- Profile showcases: earned badges and a favourite route.
update public.profiles p set
  showcase_badges = coalesce((select array_agg(badge_code order by earned_at desc) from (
    select badge_code, earned_at from public.user_badges b where b.user_id = p.id order by earned_at desc limit 4) x), '{}'),
  favourite_route_ids = array['5eed0005-0000-4000-8000-000000000001'::uuid]
where p.id in (pg_temp.p(1), pg_temp.p(2), pg_temp.p(4), pg_temp.p(16), pg_temp.p(11));
update public.profiles set favourite_route_ids = array['5eed0005-0000-4000-8000-000000000002'::uuid]
 where id in (pg_temp.p(10), pg_temp.p(13));

-- ---------------------------------------------------------------------------
-- Reactions and comments from followers on recent shared activities
-- ---------------------------------------------------------------------------

insert into public.activity_reactions (activity_id, user_id, created_at)
select a.id, f.follower_id, a.ended_at + make_interval(mins => 20 + (abs(hashtext(a.id::text || f.follower_id::text)) % 400))
from public.activities a
join public.follows f on f.followee_id = a.user_id and f.status = 'accepted'
where a.user_id between pg_temp.p(1) and pg_temp.p(22)
  and f.follower_id between pg_temp.p(1) and pg_temp.p(22)
  and a.status = 'ready' and a.visibility in ('public', 'followers')
  and a.started_at > now() - interval '30 days'
  and abs(hashtext(a.id::text || f.follower_id::text)) % 3 <> 0
on conflict do nothing;

insert into public.activity_comments (id, activity_id, author_id, body, created_at)
select pg_temp.o(24, v.i), v.activity, pg_temp.p(v.author), v.body,
       (select ended_at from public.activities where id = v.activity) + make_interval(hours => v.h)
from (values
  (1, pg_temp.act(1, 'KBR 10K time trial'), 2, 'Negative split on your first time trial! Brilliant pacing.', 1),
  (2, pg_temp.act(1, 'KBR 10K time trial'), 17, 'Exactly the plan. Well done, Meera.', 2),
  (3, pg_temp.act(1, 'KBR 10K time trial'), 11, 'So proud of you. Half marathon next!', 3),
  (4, pg_temp.act(1, 'Sunday long run'), 7, 'Longest one yet? You''re flying.', 2),
  (5, pg_temp.act(1, 'Sunday long run'), 15, 'Coffee next time, as promised!', 4),
  (6, pg_temp.act(4, 'KBR 10K time trial'), 16, 'Fastest of the morning. Teach me your ways.', 1),
  (7, pg_temp.act(16, 'Easy run at KBR'), 4, 'Nice and easy, exactly right before Wednesday.', 3),
  (8, pg_temp.act(11, 'Tempo run'), 1, 'That tempo looked strong!', 2),
  (9, pg_temp.act(2, 'Sunday long run'), 1, 'Thanks for pacing us last week.', 5),
  (10, pg_temp.act(10, 'Track intervals: 6 × 800 m'), 13, 'Same time on every rep. Textbook.', 1)
) as v (i, activity, author, body, h)
where v.activity is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Coaching notes (written as the coach, so the guard checks the assignment)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.p(17));
insert into public.coach_notes (id, coach_id, runner_id, kind, body, activity_id, created_at)
select pg_temp.o(12, 1), pg_temp.p(17), pg_temp.p(1), 'workout_feedback',
       'Great pacing: you held back early and finished faster. That''s the skill that matters most for the half marathon.',
       pg_temp.act(1, 'KBR 10K time trial'), now() - interval '22 days'
where pg_temp.act(1, 'KBR 10K time trial') is not null
on conflict (id) do nothing;
insert into public.coach_notes (id, coach_id, runner_id, kind, body, created_at)
values
  (pg_temp.o(12, 2), pg_temp.p(17), pg_temp.p(1), 'recommendation',
   'Keep tempo runs at "comfortably hard": you should be able to say a few words. If a week feels heavy, swap the tempo for an easy run.', now() - interval '5 days'),
  (pg_temp.o(12, 3), pg_temp.p(17), pg_temp.p(5), 'progress_note',
   'Three weeks of Couch to 5K done, every session completed. Repeating a week is always fine.', now() - interval '3 days'),
  (pg_temp.o(12, 4), pg_temp.p(17), pg_temp.p(9), 'recommendation',
   'Calf feeling good? Keep the strength sessions twice a week while the running builds back up.', now() - interval '4 days')
on conflict (id) do nothing;
select pg_temp.act_as(pg_temp.p(1));
insert into public.coach_note_replies (id, note_id, author_id, body, created_at)
values (pg_temp.o(12, 101), pg_temp.o(12, 2), pg_temp.p(1), 'Thanks! I''ll try that on Thursday.', now() - interval '4 days')
on conflict (id) do nothing;
select pg_temp.act_as(null);

-- Insert triggers stamp these with now(); move them to when they happened.
update public.coach_notes set created_at = case id
    when pg_temp.o(12, 1) then now() - interval '22 days'
    when pg_temp.o(12, 2) then now() - interval '5 days'
    when pg_temp.o(12, 3) then now() - interval '3 days'
    else now() - interval '4 days' end
 where id in (pg_temp.o(12, 1), pg_temp.o(12, 2), pg_temp.o(12, 3), pg_temp.o(12, 4));
update public.coach_note_replies set created_at = now() - interval '4 days' where id = pg_temp.o(12, 101);
update public.activity_comments c set created_at = a.ended_at + make_interval(hours => 1 + (abs(hashtext(c.id::text)) % 5))
  from public.activities a where a.id = c.activity_id and c.id::text like 'de000024-%';
update public.activity_reactions r set created_at = a.ended_at + make_interval(mins => 20 + (abs(hashtext(a.id::text || r.user_id::text)) % 400))
  from public.activities a
 where a.id = r.activity_id and r.user_id between pg_temp.p(1) and pg_temp.p(22) and a.user_id between pg_temp.p(1) and pg_temp.p(22);
