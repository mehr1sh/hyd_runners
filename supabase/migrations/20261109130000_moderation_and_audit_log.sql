-- Content reports, moderation and an append-only audit log (Release 0,
-- workstream B). Depends on 20261109120000_coach_and_message_access.
--
-- * Members report a message they received, or a feedback reply / feedback
--   item they can see, through public.report_content(). Reports are
--   deduplicated per reporter and target and rate limited.
-- * Moderators (programme managers and admins) see the report queue. They
--   never read private messages directly: public.moderation_report_content()
--   returns only the reported item and writes an audit entry every time.
-- * public.resolve_report() records the decision; "hide_content" hides a
--   message or feedback reply from both participants.
-- * public.audit_log is written only by database triggers and SECURITY
--   DEFINER functions. Nobody, including admins and the service role, can
--   insert, edit or delete entries through the API; UPDATE, DELETE and
--   TRUNCATE are rejected by triggers for every role. Message bodies,
--   report details and credentials are never logged.

-- ---------------------------------------------------------------------------
-- Rate limiting (shared helper; applied to more tables in workstream E)
-- ---------------------------------------------------------------------------

create table private.rate_limit_events (
  user_id uuid not null,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx on private.rate_limit_events (user_id, bucket, created_at desc);

comment on table private.rate_limit_events is
  'One row per rate-limited action. Rows older than a day are pruned on write.';

revoke all on private.rate_limit_events from public, anon, authenticated;

-- Raises SQLSTATE PT429 (PostgREST answers HTTP 429) when the caller has
-- already performed `max_count` actions in `bucket` within `period`.
-- A transaction-scoped advisory lock serialises concurrent requests from the
-- same user and bucket, so parallel requests cannot all pass the check.
create function private.enforce_rate_limit(bucket text, max_count int, period interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  -- The service role and migrations are not rate limited.
  if uid is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || bucket, 0));

  delete from private.rate_limit_events e
   where e.user_id = uid and e.bucket = enforce_rate_limit.bucket and e.created_at < now() - interval '1 day';

  select count(*) into recent
    from private.rate_limit_events e
   where e.user_id = uid
     and e.bucket = enforce_rate_limit.bucket
     and e.created_at > now() - period;

  if recent >= max_count then
    raise exception 'rate_limited'
      using errcode = 'PT429',
            detail = bucket,
            hint = 'Too many requests. Please wait a little and try again.';
  end if;

  insert into private.rate_limit_events (user_id, bucket) values (uid, enforce_rate_limit.bucket);
end;
$$;

revoke all on function private.enforce_rate_limit(text, int, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- No foreign keys: entries must outlive the accounts they mention.
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'service', 'system')),
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id text,
  subject_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096)
);

comment on table public.audit_log is
  'Append-only record of security-sensitive actions. Written only by database triggers and definer functions.';
comment on column public.audit_log.subject_id is 'The person affected by the action, when there is one.';

create index audit_log_occurred_idx on public.audit_log (occurred_at desc, id desc);
create index audit_log_subject_idx on public.audit_log (subject_id, occurred_at desc);
create index audit_log_action_idx on public.audit_log (action, occurred_at desc);

create function private.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_or_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

create policy "audit_log: admins read"
  on public.audit_log for select to authenticated
  using ((select private.has_role('admin')));

-- The single writer. Not executable through the API.
create function private.write_audit(
  action text,
  target_type text,
  target_id text,
  subject_id uuid,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  claimed_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  cause text := nullif(current_setting('hyd.audit_cause', true), '');
begin
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, subject_id, metadata)
  values (
    uid,
    case when uid is not null then 'user' when claimed_role = 'service_role' then 'service' else 'system' end,
    action,
    target_type,
    target_id,
    subject_id,
    coalesce(metadata, '{}'::jsonb) || case when cause is null then '{}'::jsonb else jsonb_build_object('cause', cause) end
  );
end;
$$;

revoke all on function private.write_audit(text, text, text, uuid, jsonb) from public, anon, authenticated;

-- Role grants and revocations.
create function private.audit_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('role.granted', 'user_role', new.user_id::text || ':' || new.role, new.user_id,
      jsonb_build_object('role', new.role, 'granted_by', new.granted_by));
    return new;
  end if;
  perform private.write_audit('role.revoked', 'user_role', old.user_id::text || ':' || old.role, old.user_id,
    jsonb_build_object('role', old.role));
  return old;
end;
$$;

create trigger user_roles_audit
  after insert or delete on public.user_roles
  for each row execute function private.audit_user_roles();

-- Coach assignment changes.
create function private.audit_coach_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('coach_assignment.created', 'coach_assignment', new.id::text, new.runner_id,
      jsonb_build_object('coach_id', new.coach_id, 'runner_id', new.runner_id));
    return new;
  end if;
  perform private.write_audit('coach_assignment.removed', 'coach_assignment', old.id::text, old.runner_id,
    jsonb_build_object('coach_id', old.coach_id, 'runner_id', old.runner_id));
  return old;
end;
$$;

create trigger coach_assignments_audit
  after insert or delete on public.coach_assignments
  for each row execute function private.audit_coach_assignments();

-- Feedback (re)assignment. The feedback text is not logged.
create function private.audit_feedback_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    case when new.assigned_to is null then 'feedback.unassigned' else 'feedback.assigned' end,
    'feedback', new.id::text, new.user_id,
    jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  return new;
end;
$$;

create trigger feedback_assignment_audit
  after update of assigned_to on public.feedback
  for each row when (old.assigned_to is distinct from new.assigned_to)
  execute function private.audit_feedback_assignment();

-- Decisions on programme place requests.
create function private.audit_enrollment_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    case
      when new.status = 'active' then 'enrollment.approved'
      when auth.uid() is not distinct from new.user_id then 'enrollment.cancelled'
      else 'enrollment.declined'
    end,
    'enrollment', new.id::text, new.user_id,
    jsonb_build_object('programme_id', new.programme_id, 'from', old.status, 'to', new.status));
  return new;
end;
$$;

create trigger enrollments_decision_audit
  after update of status on public.enrollments
  for each row when (old.status = 'requested' and new.status is distinct from old.status)
  execute function private.audit_enrollment_decision();

-- Label assignment removals and unassignments made by the revocation cleanup.
create or replace function private.cleanup_after_role_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('coach', 'mentor', 'programme_manager', 'admin')
     and not private.holds_assignee_role(old.user_id) then
    perform set_config('hyd.audit_cause', 'role_revoked', true);
    delete from public.coach_assignments where coach_id = old.user_id;
    -- The feedback stays; it returns to the managers' unassigned queue.
    update public.feedback set assigned_to = null where assigned_to = old.user_id;
    perform set_config('hyd.audit_cause', '', true);
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderated content
-- ---------------------------------------------------------------------------

alter table public.messages
  add column hidden_at timestamptz,
  add column hidden_by uuid references public.profiles (id) on delete set null;
alter table public.feedback_replies
  add column hidden_at timestamptz,
  add column hidden_by uuid references public.profiles (id) on delete set null;

comment on column public.messages.hidden_at is 'Set when a moderator hides the message after a report.';
comment on column public.feedback_replies.hidden_at is 'Set when a moderator hides the reply after a report.';

-- The new columns are readable like the rest of the row; only moderation
-- functions can set them (authenticated has no UPDATE grant on either table).

-- ---------------------------------------------------------------------------
-- Content reports
-- ---------------------------------------------------------------------------

create type public.report_target as enum ('message', 'feedback', 'feedback_reply');
create type public.report_reason as enum ('harassment', 'spam', 'inappropriate', 'safety', 'other');
create type public.report_status as enum ('open', 'dismissed', 'actioned');
create type public.report_decision as enum ('dismiss', 'uphold', 'hide_content');

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type public.report_target not null,
  target_id uuid not null,
  -- Author of the reported content.
  subject_id uuid references public.profiles (id) on delete set null,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) between 1 and 1000),
  status public.report_status not null default 'open',
  decision public.report_decision,
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 1 and 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id),
  constraint content_reports_resolution check (
    (status = 'open' and decision is null and resolved_at is null)
    or (status <> 'open' and decision is not null and resolved_at is not null)
  )
);

comment on table public.content_reports is
  'Reports of user content. Created and resolved only through report_content() and resolve_report().';

create index content_reports_queue_idx on public.content_reports (status, created_at);
create index content_reports_target_idx on public.content_reports (target_type, target_id);
create index content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);

revoke all on public.content_reports from anon, authenticated;
grant select on public.content_reports to authenticated;

alter table public.content_reports enable row level security;

create policy "content_reports: reporters read own"
  on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy "content_reports: moderators read"
  on public.content_reports for select to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.has_role('programme_manager')) or (select private.has_role('admin'));
$$;

revoke all on function private.is_moderator() from public;
grant execute on function private.is_moderator() to authenticated;

-- Report something the caller can see and did not write. Every refusal uses
-- the same message so that reports cannot be used to probe for content.
create function public.report_content(
  p_target_type public.report_target,
  p_target_id uuid,
  p_reason public.report_reason,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  author uuid;
  new_id uuid;
  clean_details text := nullif(btrim(p_details), '');
begin
  if uid is null then
    raise exception 'Sign in to report content' using errcode = '42501';
  end if;

  if p_target_type = 'message' then
    -- Only the recipient reports a message.
    select m.sender_id into author
      from public.messages m
     where m.id = p_target_id and m.recipient_id = uid and m.hidden_at is null;
  elsif p_target_type = 'feedback_reply' then
    select r.author_id into author
      from public.feedback_replies r
      join public.feedback f on f.id = r.feedback_id
     where r.id = p_target_id
       and r.hidden_at is null
       and (
         f.user_id = uid
         or (f.assigned_to = uid and private.holds_assignee_role(uid))
         or private.is_moderator()
       );
  elsif p_target_type = 'feedback' then
    -- Staff who can see a feedback item may report it.
    select f.user_id into author
      from public.feedback f
     where f.id = p_target_id
       and ((f.assigned_to = uid and private.holds_assignee_role(uid)) or private.is_moderator());
  end if;

  if author is null or author = uid then
    raise exception 'That content cannot be reported' using errcode = '42501';
  end if;

  if clean_details is not null and char_length(clean_details) > 1000 then
    raise exception 'Details must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.content_reports cr
     where cr.reporter_id = uid and cr.target_type = p_target_type and cr.target_id = p_target_id
  ) then
    raise exception 'You have already reported this' using errcode = '23505';
  end if;

  perform private.enforce_rate_limit('content_report', 10, interval '1 hour');

  insert into public.content_reports (reporter_id, target_type, target_id, subject_id, reason, details)
  values (uid, p_target_type, p_target_id, author, p_reason, clean_details)
  returning id into new_id;

  perform private.write_audit('report.submitted', 'content_report', new_id::text, author,
    jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', p_reason));
  return new_id;
end;
$$;

-- The reported item, for moderators only. Each call is audited.
create function public.moderation_report_content(p_report_id uuid)
returns table (
  target_type public.report_target,
  body text,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  hidden_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  report public.content_reports%rowtype;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  perform private.write_audit('report.content_viewed', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('target_type', report.target_type, 'target_id', report.target_id));

  if report.target_type = 'message' then
    return query
      select report.target_type, m.body, m.sender_id, p.display_name, m.created_at, m.hidden_at
        from public.messages m
        left join public.profiles p on p.id = m.sender_id
       where m.id = report.target_id;
  elsif report.target_type = 'feedback_reply' then
    return query
      select report.target_type, r.body, r.author_id, p.display_name, r.created_at, r.hidden_at
        from public.feedback_replies r
        left join public.profiles p on p.id = r.author_id
       where r.id = report.target_id;
  else
    return query
      select report.target_type, f.body, f.user_id, p.display_name, f.created_at, null::timestamptz
        from public.feedback f
        left join public.profiles p on p.id = f.user_id
       where f.id = report.target_id;
  end if;
end;
$$;

-- Record a decision. hide_content hides the message or reply and closes every
-- other open report on the same item.
create function public.resolve_report(
  p_report_id uuid,
  p_decision public.report_decision,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  report public.content_reports%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  new_status public.report_status := case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if report.status <> 'open' then
    raise exception 'This report has already been resolved' using errcode = '55000';
  end if;
  if report.subject_id = uid or report.reporter_id = uid then
    raise exception 'Another moderator must resolve a report you are part of' using errcode = '42501';
  end if;
  if p_decision = 'hide_content' and report.target_type = 'feedback' then
    raise exception 'Feedback items cannot be hidden; uphold or dismiss the report' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if p_decision = 'hide_content' then
    if report.target_type = 'message' then
      update public.messages set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('message.hidden', 'message', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    else
      update public.feedback_replies set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('feedback_reply.hidden', 'feedback_reply', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    end if;
  end if;

  update public.content_reports cr
     set status = new_status, decision = p_decision, resolution_note = clean_note,
         resolved_by = uid, resolved_at = now()
   where cr.id = report.id
      or (p_decision = 'hide_content' and cr.status = 'open'
          and cr.target_type = report.target_type and cr.target_id = report.target_id);

  perform private.write_audit('report.resolved', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('decision', p_decision, 'target_type', report.target_type, 'target_id', report.target_id));
end;
$$;

revoke all on function public.report_content(public.report_target, uuid, public.report_reason, text) from public, anon;
revoke all on function public.moderation_report_content(uuid) from public, anon;
revoke all on function public.resolve_report(uuid, public.report_decision, text) from public, anon;
grant execute on function public.report_content(public.report_target, uuid, public.report_reason, text) to authenticated;
grant execute on function public.moderation_report_content(uuid) to authenticated;
grant execute on function public.resolve_report(uuid, public.report_decision, text) to authenticated;
