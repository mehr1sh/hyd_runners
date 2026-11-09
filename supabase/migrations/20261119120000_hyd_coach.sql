-- HYD Coach: conversations grounded in the runner's own data.
--
-- * Conversations and messages are owner-only. Nobody else (staff included)
--   can read them; the runner can delete a conversation at any time.
-- * Retention: a conversation is removed 180 days after its last message
--   (purge_my_stale_coach_conversations, run by the app on each visit, and
--   private.purge_stale_coach_conversations for an operator-scheduled sweep).
-- * Coach replies are written by the server with the runner's own session;
--   the stored payload records the facts each answer was based on.
-- * ai_calls gains the coach feature and token/model columns for cost tracking.

create table public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index coach_conversations_user_idx on public.coach_conversations (user_id, last_message_at desc);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coach_conversations (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  role text not null check (role in ('runner', 'coach')),
  body text not null check (char_length(body) between 1 and 4000),
  -- For coach replies: intent, facts used, missing data, links, uncertainty and source.
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'),
  source text check (source in ('deterministic', 'ai_assisted', 'safety')),
  created_at timestamptz not null default now(),
  constraint coach_messages_runner_plain check (role = 'coach' or (payload is null and source is null))
);
create index coach_messages_conversation_idx on public.coach_messages (conversation_id, created_at);
create index coach_messages_user_idx on public.coach_messages (user_id);

create function private.coach_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'runner' then
    perform private.enforce_rate_limit('hyd_coach', 60, interval '1 hour');
  end if;
  new.created_at := now();
  -- The conversation must belong to the same runner.
  if not exists (select 1 from public.coach_conversations c
                  where c.id = new.conversation_id and c.user_id = new.user_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;
  update public.coach_conversations set last_message_at = now() where id = new.conversation_id;
  return new;
end;
$$;
create trigger coach_messages_before_insert before insert on public.coach_messages
  for each row execute function private.coach_messages_before_insert();

create function private.coach_conversations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('hyd_coach_conversation', 30, interval '1 day');
  new.created_at := now();
  new.last_message_at := now();
  return new;
end;
$$;
create trigger coach_conversations_before_insert before insert on public.coach_conversations
  for each row execute function private.coach_conversations_before_insert();

alter table public.coach_conversations enable row level security;
alter table public.coach_messages enable row level security;
revoke all on public.coach_conversations, public.coach_messages from anon, authenticated;
grant select, delete on public.coach_conversations to authenticated;
grant insert (id, user_id, title) on public.coach_conversations to authenticated;
grant update (title) on public.coach_conversations to authenticated;
grant select on public.coach_messages to authenticated;
grant insert (id, conversation_id, user_id, role, body, payload, source) on public.coach_messages to authenticated;

create policy "coach_conversations: owner" on public.coach_conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy "coach_conversations: owner creates" on public.coach_conversations for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "coach_conversations: owner renames" on public.coach_conversations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "coach_conversations: owner deletes" on public.coach_conversations for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "coach_messages: owner" on public.coach_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "coach_messages: owner writes" on public.coach_messages for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Retention ---------------------------------------------------------------

create function public.purge_my_stale_coach_conversations()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with gone as (
    delete from public.coach_conversations
     where user_id = (select auth.uid()) and last_message_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function public.purge_my_stale_coach_conversations() from public, anon;
grant execute on function public.purge_my_stale_coach_conversations() to authenticated;

-- For an operator sweep (service role / scheduled job); not callable by users.
create function private.purge_stale_coach_conversations()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.coach_conversations where last_message_at < now() - interval '180 days' returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function private.purge_stale_coach_conversations() from public, anon, authenticated;

-- AI usage: coach feature and cost tracking -------------------------------

alter table public.ai_calls drop constraint ai_calls_feature_check;
alter table public.ai_calls add constraint ai_calls_feature_check
  check (feature in ('timetable_extraction', 'schedule_suggestion', 'hyd_coach'));
alter table public.ai_calls
  add column model text check (model is null or char_length(model) <= 80),
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column output_tokens integer check (output_tokens is null or output_tokens >= 0);
grant insert (model, input_tokens, output_tokens) on public.ai_calls to authenticated;
