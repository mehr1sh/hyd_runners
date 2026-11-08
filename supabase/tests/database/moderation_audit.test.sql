-- pgTAP: content reports, moderation and the append-only audit log
-- (migration 20261109130000_moderation_and_audit_log).
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- R1, R2: runners. C: coach of R1. M, M2: programme managers. A: admin.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('2b000000-0000-4000-8000-0000000000a1', 'mod.r1@example.test', '{"display_name":"Mod Runner 1"}', 'authenticated', 'authenticated'),
  ('2b000000-0000-4000-8000-0000000000a2', 'mod.r2@example.test', '{"display_name":"Mod Runner 2"}', 'authenticated', 'authenticated'),
  ('2b000000-0000-4000-8000-0000000000c1', 'mod.c@example.test', '{"display_name":"Mod Coach"}', 'authenticated', 'authenticated'),
  ('2b000000-0000-4000-8000-0000000000d1', 'mod.m@example.test', '{"display_name":"Mod Manager"}', 'authenticated', 'authenticated'),
  ('2b000000-0000-4000-8000-0000000000d2', 'mod.m2@example.test', '{"display_name":"Mod Manager 2"}', 'authenticated', 'authenticated'),
  ('2b000000-0000-4000-8000-0000000000e1', 'mod.a@example.test', '{"display_name":"Mod Admin"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- audit: role and assignment changes
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000e1');
reset role;
insert into public.user_roles (user_id, role) values ('2b000000-0000-4000-8000-0000000000e1', 'admin');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000e1');
select lives_ok(
  $$ insert into public.user_roles (user_id, role, granted_by) values
       ('2b000000-0000-4000-8000-0000000000c1', 'coach', '2b000000-0000-4000-8000-0000000000e1'),
       ('2b000000-0000-4000-8000-0000000000d1', 'programme_manager', '2b000000-0000-4000-8000-0000000000e1'),
       ('2b000000-0000-4000-8000-0000000000d2', 'programme_manager', '2b000000-0000-4000-8000-0000000000e1') $$,
  'an admin grants staff roles');
select is(
  (select count(*)::int from public.audit_log
    where action = 'role.granted' and actor_id = '2b000000-0000-4000-8000-0000000000e1' and actor_kind = 'user'
      and subject_id = '2b000000-0000-4000-8000-0000000000c1' and metadata->>'role' = 'coach'),
  1, 'role grants are audited with actor, subject and role');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$ insert into public.coach_assignments (coach_id, runner_id, assigned_by)
     values ('2b000000-0000-4000-8000-0000000000c1', '2b000000-0000-4000-8000-0000000000a1', '2b000000-0000-4000-8000-0000000000d1') $$,
  'a manager assigns a coach');
reset role;
select is(
  (select count(*)::int from public.audit_log
    where action = 'coach_assignment.created' and actor_id = '2b000000-0000-4000-8000-0000000000d1'
      and subject_id = '2b000000-0000-4000-8000-0000000000a1'
      and metadata->>'coach_id' = '2b000000-0000-4000-8000-0000000000c1'),
  1, 'coach assignments are audited');

insert into public.feedback (id, user_id, target, body, barrier) values
  ('2b000000-0000-4000-8000-0000000000f1', '2b000000-0000-4000-8000-0000000000a1', 'app', 'Private feedback text', 'other');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
update public.feedback set assigned_to = '2b000000-0000-4000-8000-0000000000c1' where id = '2b000000-0000-4000-8000-0000000000f1';
reset role;
select is(
  (select metadata->>'to' from public.audit_log where action = 'feedback.assigned' and target_id = '2b000000-0000-4000-8000-0000000000f1'),
  '2b000000-0000-4000-8000-0000000000c1', 'feedback assignment is audited');

-- ---------------------------------------------------------------- audit: enrolment decisions
insert into public.programmes (id, slug, title, kind, category, level, duration_weeks, sessions_per_week, enrolment, published)
values ('2b000000-0000-4000-8000-0000000000b1', 'mod-test-plan', 'Mod test plan', 'custom', 'running', 'beginner', 1, 1, 'coach_approval', true);
insert into public.enrollments (id, user_id, programme_id, status) values
  ('2b000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000a1', '2b000000-0000-4000-8000-0000000000b1', 'requested'),
  ('2b000000-0000-4000-8000-0000000000b3', '2b000000-0000-4000-8000-0000000000a2', '2b000000-0000-4000-8000-0000000000b1', 'requested');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000c1');
update public.enrollments set status = 'active' where id = '2b000000-0000-4000-8000-0000000000b2';
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
update public.enrollments set status = 'withdrawn' where id = '2b000000-0000-4000-8000-0000000000b3';
reset role;
select is(
  (select actor_id::text from public.audit_log where action = 'enrollment.approved' and target_id = '2b000000-0000-4000-8000-0000000000b2'),
  '2b000000-0000-4000-8000-0000000000c1', 'enrolment approvals are audited with the approving coach');
select is(
  (select actor_id::text from public.audit_log where action = 'enrollment.declined' and target_id = '2b000000-0000-4000-8000-0000000000b3'),
  '2b000000-0000-4000-8000-0000000000d1', 'enrolment rejections are audited');

-- ---------------------------------------------------------------- audit: revocation cascade
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
delete from public.user_roles where user_id = '2b000000-0000-4000-8000-0000000000c1' and role = 'coach';
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'role.revoked' and subject_id = '2b000000-0000-4000-8000-0000000000c1'
     and actor_id = '2b000000-0000-4000-8000-0000000000d1'),
  1, 'role revocations are audited');
select is(
  (select metadata->>'cause' from public.audit_log where action = 'coach_assignment.removed'
     and metadata->>'coach_id' = '2b000000-0000-4000-8000-0000000000c1'),
  'role_revoked', 'assignments removed by a revocation are audited with the cause');
select is(
  (select metadata->>'cause' from public.audit_log where action = 'feedback.unassigned' and target_id = '2b000000-0000-4000-8000-0000000000f1'),
  'role_revoked', 'feedback returned by a revocation is audited with the cause');
select set_config('request.jwt.claims', '', true);
insert into public.user_roles (user_id, role) values ('2b000000-0000-4000-8000-0000000000c1', 'coach');
insert into public.coach_assignments (coach_id, runner_id) values ('2b000000-0000-4000-8000-0000000000c1', '2b000000-0000-4000-8000-0000000000a1');
update public.feedback set assigned_to = '2b000000-0000-4000-8000-0000000000c1' where id = '2b000000-0000-4000-8000-0000000000f1';
select is(
  (select actor_kind from public.audit_log where action = 'coach_assignment.created' order by id desc limit 1),
  'system', 'changes made outside a user session are labelled as system');

-- ---------------------------------------------------------------- audit: append-only, admin-only
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
select is((select count(*)::int from public.audit_log), 0, 'managers cannot read the audit log');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.audit_log), 0, 'runners cannot read the audit log');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000e1');
select ok((select count(*) from public.audit_log) > 0, 'admins read the audit log');
select throws_ok($$ insert into public.audit_log (actor_kind, action, target_type) values ('user', 'role.granted', 'x') $$,
  '42501', null, 'admins cannot insert audit entries');
select throws_ok($$ update public.audit_log set action = 'role.revoked' $$, '42501', null, 'admins cannot edit audit entries');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'admins cannot delete audit entries');
select set_config('role', 'service_role', true);
select throws_ok($$ insert into public.audit_log (actor_kind, action, target_type) values ('user', 'role.granted', 'x') $$,
  '42501', null, 'the service role cannot insert audit entries');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'the service role cannot delete audit entries');
select throws_ok($$ select private.write_audit('role.granted', 'x', null, null) $$, '42501', null,
  'the service role cannot call the audit writer');
reset role;
select throws_ok($$ update public.audit_log set action = 'role.revoked' $$, '42501', 'The audit log is append-only',
  'even the table owner cannot edit audit entries');
select throws_ok($$ delete from public.audit_log $$, '42501', 'The audit log is append-only',
  'even the table owner cannot delete audit entries');
select throws_ok($$ truncate public.audit_log $$, '42501', 'The audit log is append-only',
  'the audit log cannot be truncated');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a1');
select throws_ok($$ select private.write_audit('role.granted', 'x', null, null) $$, '42501', null,
  'signed-in users cannot call the audit writer');

-- ---------------------------------------------------------------- reports: submitting
reset role;
insert into public.messages (id, sender_id, recipient_id, body) values
  ('2b000000-0000-4000-8000-000000000101', '2b000000-0000-4000-8000-0000000000c1', '2b000000-0000-4000-8000-0000000000a1', 'Abusive message text'),
  ('2b000000-0000-4000-8000-000000000102', '2b000000-0000-4000-8000-0000000000a1', '2b000000-0000-4000-8000-0000000000c1', 'Reply text'),
  ('2b000000-0000-4000-8000-000000000103', '2b000000-0000-4000-8000-0000000000d1', '2b000000-0000-4000-8000-0000000000a2', 'Manager note');
insert into public.feedback_replies (id, feedback_id, author_id, body) values
  ('2b000000-0000-4000-8000-000000000201', '2b000000-0000-4000-8000-0000000000f1', '2b000000-0000-4000-8000-0000000000c1', 'Rude reply text');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select public.report_content('message', '2b000000-0000-4000-8000-000000000101', 'harassment', 'This felt threatening') $$,
  'the recipient reports a message');
select throws_ok(
  $$ select public.report_content('message', '2b000000-0000-4000-8000-000000000101', 'spam') $$,
  '23505', 'You have already reported this', 'the same person cannot report the same message twice');
select throws_ok(
  $$ select public.report_content('message', '2b000000-0000-4000-8000-000000000102', 'spam') $$,
  '42501', 'That content cannot be reported', 'a sender cannot report their own message');
select throws_ok(
  $$ select public.report_content('message', '2b000000-0000-4000-8000-000000000103', 'spam') $$,
  '42501', 'That content cannot be reported', 'a non-participant cannot report a message (same refusal as missing content)');
select throws_ok(
  $$ select public.report_content('message', gen_random_uuid(), 'spam') $$,
  '42501', 'That content cannot be reported', 'reporting unknown content gives the same refusal');
select throws_ok(
  $$ select public.report_content('feedback', '2b000000-0000-4000-8000-0000000000f1', 'spam') $$,
  '42501', 'That content cannot be reported', 'a runner cannot report their own feedback');
select lives_ok(
  $$ select public.report_content('feedback_reply', '2b000000-0000-4000-8000-000000000201', 'inappropriate') $$,
  'a runner reports a reply on their feedback');
select throws_ok(
  $$ insert into public.content_reports (reporter_id, target_type, target_id, reason)
     values ('2b000000-0000-4000-8000-0000000000a1', 'message', '2b000000-0000-4000-8000-000000000103', 'spam') $$,
  '42501', null, 'reports cannot be inserted directly');
select throws_ok($$ update public.content_reports set status = 'dismissed' $$, '42501', null, 'reports cannot be edited directly');
select is((select count(*)::int from public.content_reports), 2, 'a reporter reads their own reports');
select is(
  (select count(*)::int from public.audit_log), 0, 'reporters still cannot read the audit log');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.content_reports), 0, 'other runners cannot read reports');
select throws_ok($$ select * from public.moderation_report_content((select id from public.content_reports limit 1)) $$,
  '42501', 'Moderators only', 'runners cannot open reported content');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000c1');
select lives_ok(
  $$ select public.report_content('feedback', '2b000000-0000-4000-8000-0000000000f1', 'other', 'Contains a phone number') $$,
  'an assigned coach reports a feedback item');
select is((select count(*)::int from public.content_reports), 1, 'a coach reads only the reports they filed');
select throws_ok($$ select public.resolve_report((select id from public.content_reports limit 1), 'dismiss') $$,
  '42501', 'Moderators only', 'coaches cannot resolve reports');

-- ---------------------------------------------------------------- moderation
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d2');
select is((select count(*)::int from public.content_reports where reporter_id::text like '2b000000-%'), 3, 'moderators see the report queue');
select is((select count(*)::int from public.messages where id = '2b000000-0000-4000-8000-000000000101'), 0,
  'moderators still cannot read the reported message directly');
select is(
  (select body from public.moderation_report_content(
     (select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000101'))),
  'Abusive message text', 'moderators read the reported message through its report');
select is(
  (select author_name from public.moderation_report_content(
     (select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000101'))),
  'Mod Coach', 'the moderation view names the author');
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'report.content_viewed'
     and actor_id = '2b000000-0000-4000-8000-0000000000d2'),
  2, 'each moderator view of reported content is audited');
select is(
  (select count(*)::int from public.audit_log
    where metadata::text like '%Abusive message text%' or metadata::text like '%threatening%'
       or metadata::text like '%Private feedback text%' or metadata::text like '%Rude reply text%'),
  0, 'the audit log never contains message bodies, feedback text or report details');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d2');
select throws_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_type = 'feedback'), 'hide_content') $$,
  '22023', null, 'feedback items cannot be hidden');
select lives_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000101'),
                                  'hide_content', 'Threatening language') $$,
  'a moderator hides a reported message');
select throws_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000101'), 'dismiss') $$,
  '55000', 'This report has already been resolved', 'a resolved report cannot be resolved again');
select lives_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_type = 'feedback'), 'uphold', 'Asked runner to remove details') $$,
  'a moderator upholds a report without hiding');
select lives_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_type = 'feedback_reply'), 'dismiss') $$,
  'a moderator dismisses a report');
reset role;
select is(
  (select status::text || ':' || decision::text || ':' || resolved_by::text from public.content_reports
    where target_id = '2b000000-0000-4000-8000-000000000101'),
  'actioned:hide_content:2b000000-0000-4000-8000-0000000000d2', 'the decision and moderator are recorded');
select isnt((select hidden_at from public.messages where id = '2b000000-0000-4000-8000-000000000101'), null, 'the message is hidden');
select is((select hidden_at from public.feedback_replies where id = '2b000000-0000-4000-8000-000000000201'), null,
  'a dismissed report leaves the content visible');
select is(
  (select count(*)::int from public.audit_log where action in ('report.resolved', 'message.hidden')
     and actor_id = '2b000000-0000-4000-8000-0000000000d2'),
  4, 'resolutions and hidden messages are audited');
select is((select count(*)::int from public.messages where id = '2b000000-0000-4000-8000-000000000101'), 1,
  'hidden messages are kept as evidence');

select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ select public.report_content('message', '2b000000-0000-4000-8000-000000000101', 'spam') $$,
  '42501', 'That content cannot be reported', 'hidden content cannot be reported again');
select is((select status::text from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000101'), 'actioned',
  'the reporter sees the outcome of their report');

-- A moderator cannot decide a report about themselves.
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a2');
select lives_ok($$ select public.report_content('message', '2b000000-0000-4000-8000-000000000103', 'spam') $$,
  'a runner reports a manager''s message');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000d1');
select throws_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000103'), 'dismiss') $$,
  '42501', 'Another moderator must resolve a report you are part of', 'a moderator cannot resolve a report about themselves');
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000e1');
select lives_ok(
  $$ select public.resolve_report((select id from public.content_reports where target_id = '2b000000-0000-4000-8000-000000000103'), 'dismiss') $$,
  'another moderator can');

-- ---------------------------------------------------------------- rate limit
reset role;
insert into public.messages (sender_id, recipient_id, body)
select '2b000000-0000-4000-8000-0000000000d1', '2b000000-0000-4000-8000-0000000000a1', 'Bulk ' || n from generate_series(1, 10) n;
select pg_temp.act_as('2b000000-0000-4000-8000-0000000000a1');
-- R1 has filed 2 reports this hour; 8 more are allowed.
select is(
  (select count(*)::int from (
     select public.report_content('message', m.id, 'spam')
       from (select id from public.messages where body like 'Bulk %' and recipient_id = '2b000000-0000-4000-8000-0000000000a1'
             order by body limit 8) m) t),
  8, 'up to ten reports an hour are accepted');
select throws_ok(
  $$ select public.report_content('message',
       (select id from public.messages where body = 'Bulk 9' and recipient_id = '2b000000-0000-4000-8000-0000000000a1'), 'spam') $$,
  'PT429', 'rate_limited', 'the eleventh report in an hour is refused');

-- ---------------------------------------------------------------- privileges
reset role;
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'audit_log' and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type <> 'SELECT'),
  0, 'no API role can write to the audit log');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'content_reports' and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'),
  0, 'reports are written only through their functions');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('report_content', 'moderation_report_content', 'resolve_report')
      and grantee = 'anon'),
  0, 'signed-out visitors cannot call the report functions');

select * from finish();
rollback;
