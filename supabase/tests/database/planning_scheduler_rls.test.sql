-- pgTAP tests for the planning (scheduler) migration. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(relrowsecurity, format('RLS enabled on %s', relname))
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('timetable_uploads', 'availability_blocks', 'weekly_plans', 'scheduled_workouts', 'ai_calls')
order by relname;

select is((select public from storage.buckets where id = 'timetables'), false, 'timetables bucket is private');

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'plan.a@example.test', '{}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'plan.b@example.test', '{}', 'authenticated', 'authenticated');

-- Runner B owns a timetable, availability and an approved plan.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

insert into public.timetable_uploads (storage_path, mime_type, size_bytes)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/11111111-1111-4111-8111-111111111111.pdf', 'application/pdf', 1000);

select public.replace_availability(
  '[{"weekday":1,"start_time":"06:00","end_time":"07:00","kind":"free","label":null,"source":"manual","confidence":null}]'::jsonb
);

select isnt(
  public.approve_weekly_plan(
    '2026-10-19', 'Asia/Kolkata', 'deterministic', '{}'::jsonb,
    '[{"title":"Run","workout_type":"walk_run","starts_at":"2026-10-19T00:30:00Z","duration_minutes":30,"planned_by":"scheduler","rationale":["x"]}]'::jsonb
  ),
  null,
  'runner can approve a plan for themselves'
);

select throws_ok(
  $$ select public.approve_weekly_plan('2026-10-19', 'Asia/Kolkata', 'deterministic', '{}'::jsonb, '[]'::jsonb) $$,
  '23505',
  null,
  'a second approval for the same week is refused without replace'
);

select lives_ok(
  $$ select public.approve_weekly_plan('2026-10-19', 'Asia/Kolkata', 'deterministic', '{}'::jsonb,
       '[{"title":"Walk","workout_type":"walk","starts_at":"2026-10-21T00:30:00Z","duration_minutes":30,"planned_by":"runner","rationale":[]}]'::jsonb,
       true) $$,
  'replace supersedes the old approved plan'
);

select is(
  (select count(*)::int from public.weekly_plans where status = 'approved'),
  1,
  'exactly one approved plan per week'
);

select is(
  (select count(*)::int from public.scheduled_workouts where status = 'planned'),
  1,
  'planned sessions of the superseded plan are withdrawn'
);

select throws_ok(
  $$ insert into public.timetable_uploads (storage_path, mime_type, size_bytes)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.pdf', 'application/pdf', 10) $$,
  '23514',
  null,
  'upload paths must live in the caller''s own folder'
);

-- Runner A cannot see or change runner B's data.
reset role;
select set_config('test.b_workout', (select id::text from public.scheduled_workouts where status = 'planned' limit 1), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select is((select count(*)::int from public.timetable_uploads), 0, 'runner cannot see another runner''s uploads');
select is((select count(*)::int from public.availability_blocks), 0, 'runner cannot see another runner''s availability');
select is((select count(*)::int from public.weekly_plans), 0, 'runner cannot see another runner''s plans');
select is((select count(*)::int from public.scheduled_workouts), 0, 'runner cannot see another runner''s sessions');

select throws_ok(
  format('select public.reschedule_workout(%L, now(), ''{}'')', current_setting('test.b_workout')),
  'P0002',
  null,
  'runner cannot reschedule a session they cannot see'
);

reset role;
select is(
  (select count(*)::int from public.scheduled_workouts where status = 'planned'
     and user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1,
  'runner B''s sessions are untouched by runner A'
);

select * from finish();
rollback;
