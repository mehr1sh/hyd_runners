-- pgTAP: coach-led enrolments can only be approved by a reviewer, through any
-- sequence of status changes, and runners keep pause/resume/withdraw.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- R: runner assigned to coach C. U: unassigned runner. C: coach.
-- X: former coach, role revoked but assignment to R left in place.
-- M: programme manager.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'r@example.test', '{"display_name":"Runner R"}', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'u@example.test', '{"display_name":"Runner U"}', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'c@example.test', '{"display_name":"Coach C"}', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'x@example.test', '{"display_name":"Former X"}', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'm@example.test', '{"display_name":"Manager M"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('eeeeeeee-0000-4000-8000-000000000003', 'coach'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'coach'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'programme_manager');
insert into public.coach_assignments (coach_id, runner_id, assigned_by) values
  ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000005'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000005');
delete from public.user_roles where user_id = 'eeeeeeee-0000-4000-8000-000000000004' and role = 'coach';

-- Two extra coach-led programmes so each scenario has its own open enrolment.
insert into public.programmes (id, slug, title, summary, kind, category, level, duration_weeks, sessions_per_week, enrolment, published) values
  ('dddddddd-0000-4000-8000-000000000001', 'test-coach-led-a', 'Coach-led A', 'Test', 'custom', 'training_and_shine', 'beginner', 4, 2, 'coach_approval', true),
  ('dddddddd-0000-4000-8000-000000000002', 'test-coach-led-b', 'Coach-led B', 'Test', 'custom', 'training_and_shine', 'beginner', 4, 2, 'coach_approval', true);

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.status_of(uid text, slug text) returns text language sql as $$
  select e.status from public.enrollments e join public.programmes p on p.id = e.programme_id
  where e.user_id = uid::uuid and p.slug = $2 order by e.created_at desc, e.status limit 1;
$$;

set local role authenticated;

-- ---------------------------------------------------------------- runner R
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000001');
insert into public.enrollments (user_id, programme_id) values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001');
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'requested', 'a coach-led enrolment starts as a request');

select throws_ok(
  $$ insert into public.enrollments (user_id, programme_id, coach_id) values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000003') $$,
  '42501', null, 'runners cannot choose their coach on insert');
select throws_ok(
  $$ insert into public.enrollments (user_id, programme_id, started_at) values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002', now() - interval '30 days') $$,
  '42501', null, 'runners cannot backdate the start on insert');

select throws_ok(
  $$ update public.enrollments set status = 'active' where programme_id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', 'enrolment requires coach approval', 'runner cannot approve their own request directly');
select throws_ok(
  $$ update public.enrollments set status = 'paused' where programme_id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', 'enrolment requires coach approval', 'runner cannot pause a request (first step of requested -> paused -> active)');
select throws_ok(
  $$ update public.enrollments set status = 'completed' where programme_id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', null, 'runner cannot complete a request');
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'requested', 'the request is still waiting for a coach');

-- ---------------------------------------------------------------- runner U requests B
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000002');
insert into public.enrollments (user_id, programme_id) values ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002');
select is((select count(*)::int from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000001'), 0, 'runners cannot read other runners'' enrolments');

-- ---------------------------------------------------------------- former coach X
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000004');
select is((select count(*)::int from public.enrollments), 0, 'a revoked coach no longer sees their former runners'' enrolments');
update public.enrollments set status = 'active' where programme_id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), null, 'a revoked coach cannot read the request (status hidden)');

-- ---------------------------------------------------------------- coach C
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000003');
select is((select array_agg(user_id)::text from public.enrollments), '{eeeeeeee-0000-4000-8000-000000000001}', 'a coach sees only their assigned runners'' enrolments');
update public.enrollments set status = 'active' where programme_id = 'dddddddd-0000-4000-8000-000000000002';
select is((select count(*)::int from public.enrollments where programme_id = 'dddddddd-0000-4000-8000-000000000002'), 0, 'a coach cannot see an unassigned runner''s request');

-- Coach C asks for a place themselves and tries to approve it.
insert into public.enrollments (user_id, programme_id) values ('eeeeeeee-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000002');
select throws_ok(
  $$ update public.enrollments set status = 'active' where user_id = 'eeeeeeee-0000-4000-8000-000000000003' $$,
  '42501', 'enrolment requires coach approval', 'staff cannot approve their own request');

-- C approves R's request.
update public.enrollments set status = 'active'
where programme_id = 'dddddddd-0000-4000-8000-000000000001' and user_id = 'eeeeeeee-0000-4000-8000-000000000001';

reset role;
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'active', 'the assigned coach approves the request');
select is((select status from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000002'), 'requested', 'the unassigned runner''s request was not changed by the coach');
select is((select status from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000003'), 'requested', 'the coach''s own request is still waiting');
select is((select coach_id::text from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000001' and programme_id = 'dddddddd-0000-4000-8000-000000000001'),
  'eeeeeeee-0000-4000-8000-000000000003', 'approval records the approving coach');
select ok((select started_at is not null from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000001' and programme_id = 'dddddddd-0000-4000-8000-000000000001'),
  'approval starts the programme');
set local role authenticated;

-- ---------------------------------------------------------------- runner R after approval
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.enrollments set status = 'completed' where programme_id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', null, 'runner cannot mark a programme completed');
select throws_ok(
  $$ update public.enrollments set status = 'requested' where programme_id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', null, 'runner cannot turn an approved programme back into a request');
update public.enrollments set status = 'paused' where programme_id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'paused', 'runner can pause an approved programme');
update public.enrollments set status = 'active' where programme_id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'active', 'runner can resume an approved programme');
update public.enrollments set status = 'withdrawn' where programme_id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'withdrawn', 'runner can leave a programme');
update public.enrollments set status = 'active' where programme_id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.status_of('eeeeeeee-0000-4000-8000-000000000001', 'test-coach-led-a'), 'withdrawn', 'a withdrawn enrolment cannot be reopened');

-- Asking again starts a new request, which the runner can withdraw.
insert into public.enrollments (user_id, programme_id) values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001');
select is((select count(*)::int from public.enrollments where programme_id = 'dddddddd-0000-4000-8000-000000000001' and status = 'requested'), 1, 'asking again creates a new request');
update public.enrollments set status = 'withdrawn' where programme_id = 'dddddddd-0000-4000-8000-000000000001' and status = 'requested';
select is((select count(*)::int from public.enrollments where programme_id = 'dddddddd-0000-4000-8000-000000000001' and status = 'requested'), 0, 'runner can withdraw their own request');

-- ---------------------------------------------------------------- manager M
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000005');
select is((select count(*)::int from public.enrollments where status = 'requested' and programme_id = 'dddddddd-0000-4000-8000-000000000002'), 2, 'a manager sees every request');
update public.enrollments set status = 'active' where user_id = 'eeeeeeee-0000-4000-8000-000000000002';
update public.enrollments set status = 'withdrawn' where user_id = 'eeeeeeee-0000-4000-8000-000000000003';
update public.enrollments set status = 'paused' where user_id = 'eeeeeeee-0000-4000-8000-000000000002';

reset role;
select is((select status from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000002'), 'active', 'a manager approves an unassigned runner''s request, but cannot then pause it');
select is((select status from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000003'), 'withdrawn', 'a manager declines a request');
select is((select coach_id::text from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000002'), 'eeeeeeee-0000-4000-8000-000000000005', 'approval records the approving manager');

-- Server-side completion still works.
update public.enrollments set status = 'completed' where user_id = 'eeeeeeee-0000-4000-8000-000000000002';
select is((select status from public.enrollments where user_id = 'eeeeeeee-0000-4000-8000-000000000002'), 'completed', 'the server can still complete an enrolment');

select * from finish();
rollback;
