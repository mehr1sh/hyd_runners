-- pgTAP: HYD Coach (migration 20261119120000_hyd_coach): conversations are
-- private to the runner (staff and assigned coaches included), messages can
-- only go into the caller's own conversations, deletion cascades, retention
-- purges only stale conversations, and AI usage records cost fields.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- A and B are runners; C coaches A (current assignment); M is an admin.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('6c000000-0000-4000-8000-0000000000a1', 'hc.a@example.test', '{"display_name":"Coach Test A"}', 'authenticated', 'authenticated'),
  ('6c000000-0000-4000-8000-0000000000b1', 'hc.b@example.test', '{"display_name":"Coach Test B"}', 'authenticated', 'authenticated'),
  ('6c000000-0000-4000-8000-0000000000c1', 'hc.c@example.test', '{"display_name":"Coach Test C"}', 'authenticated', 'authenticated'),
  ('6c000000-0000-4000-8000-0000000000d1', 'hc.m@example.test', '{"display_name":"Coach Test M"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('6c000000-0000-4000-8000-0000000000c1', 'coach'),
  ('6c000000-0000-4000-8000-0000000000d1', 'admin');
insert into public.coach_assignments (coach_id, runner_id) values
  ('6c000000-0000-4000-8000-0000000000c1', '6c000000-0000-4000-8000-0000000000a1');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.coach_conversations (id, user_id, title) values
  ('6c000000-0000-4000-8000-00000000c0a1', '6c000000-0000-4000-8000-0000000000a1', 'Am I getting faster?') $$,
  'a runner starts a conversation');
select lives_ok($$ insert into public.coach_messages (conversation_id, user_id, role, body) values
  ('6c000000-0000-4000-8000-00000000c0a1', '6c000000-0000-4000-8000-0000000000a1', 'runner', 'Am I getting faster?') $$,
  'and asks a question');
select lives_ok($$ insert into public.coach_messages (conversation_id, user_id, role, body, source, payload) values
  ('6c000000-0000-4000-8000-00000000c0a1', '6c000000-0000-4000-8000-0000000000a1', 'coach', 'Yes.', 'deterministic',
   '{"basis":[]}') $$, 'the server stores the reply with the runner''s session');
select throws_ok($$ insert into public.coach_messages (conversation_id, user_id, role, body, payload) values
  ('6c000000-0000-4000-8000-00000000c0a1', '6c000000-0000-4000-8000-0000000000a1', 'runner', 'x', '{"basis":[]}') $$,
  '23514', null, 'runner messages cannot carry an answer payload');
select throws_ok($$ insert into public.coach_conversations (user_id, title) values
  ('6c000000-0000-4000-8000-0000000000b1', 'Not mine') $$, '42501', null, 'nobody starts a conversation for someone else');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.coach_conversations), 0::bigint, 'another runner sees no conversations');
select is((select count(*) from public.coach_messages), 0::bigint, 'or messages');
select throws_ok($$ insert into public.coach_messages (conversation_id, user_id, role, body) values
  ('6c000000-0000-4000-8000-00000000c0a1', '6c000000-0000-4000-8000-0000000000b1', 'runner', 'hello') $$,
  '42501', null, 'cannot write into another runner''s conversation');
select results_eq($$ delete from public.coach_conversations returning 1 $$, $$ select 1 where false $$,
  'cannot delete another runner''s conversation');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.coach_messages), 0::bigint, 'the runner''s assigned human coach cannot read HYD Coach messages');
select pg_temp.act_as('6c000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.coach_conversations), 0::bigint, 'nor can an admin');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000a1');
select throws_ok($$ update public.coach_messages set body = 'edited' $$, '42501', null, 'messages cannot be edited');
select is((select count(*) from public.coach_messages), 2::bigint, 'the owner reads both messages');

-- Retention: back-date one conversation past 180 days.
reset role;
insert into public.coach_conversations (id, user_id, title) values
  ('6c000000-0000-4000-8000-00000000c0a2', '6c000000-0000-4000-8000-0000000000a1', 'Old'),
  ('6c000000-0000-4000-8000-00000000c0b2', '6c000000-0000-4000-8000-0000000000b1', 'Old B');
update public.coach_conversations set last_message_at = now() - interval '181 days'
 where id in ('6c000000-0000-4000-8000-00000000c0a2', '6c000000-0000-4000-8000-00000000c0b2');
select pg_temp.act_as('6c000000-0000-4000-8000-0000000000a1');
select is(public.purge_my_stale_coach_conversations(), 1, 'the runner''s stale conversation is purged');
reset role;
select is((select count(*) from public.coach_conversations where id = '6c000000-0000-4000-8000-00000000c0b2'), 1::bigint,
  'another runner''s stale conversation is left for their own purge or the operator sweep');
select ok(not has_function_privilege('authenticated', 'private.purge_stale_coach_conversations()', 'execute'),
  'users cannot run the operator sweep');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000a1');
select lives_ok($$ delete from public.coach_conversations where id = '6c000000-0000-4000-8000-00000000c0a1' $$,
  'the runner deletes a conversation');
reset role;
select is((select count(*) from public.coach_messages where conversation_id = '6c000000-0000-4000-8000-00000000c0a1'), 0::bigint,
  'and its messages go with it');

select pg_temp.act_as('6c000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.ai_calls (feature, outcome, latency_ms, model, input_tokens, output_tokens)
  values ('hyd_coach', 'success', 900, 'gemini-3.8-flash', 820, 140) $$, 'AI usage records the coach feature and tokens');
select throws_ok($$ insert into public.ai_calls (feature, outcome) values ('anything', 'success') $$,
  '23514', null, 'unknown AI features are rejected');

select * from finish();
rollback;
