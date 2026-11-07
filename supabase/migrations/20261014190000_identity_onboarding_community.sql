-- Identity onboarding preferences and community management tables.
-- Owner: identity + community (feat/identity-community).
-- Does not alter the foundation migration. Extra columns that are not yet in
-- src/lib/contracts are marked below for the foundation lead.

create type public.fitness_goal as enum (
  'build_habit',
  'first_5k',
  'run_without_stopping',
  'get_stronger',
  'return_after_break'
);

create type public.time_of_day as enum (
  'early_morning',
  'morning',
  'afternoon',
  'evening',
  'night'
);

create type public.feedback_target as enum ('session', 'programme', 'event', 'coach', 'app');

create type public.feedback_status as enum ('new', 'acknowledged', 'resolved');

create type public.announcement_audience as enum ('everyone', 'programme', 'coach_group');

-- ---------------------------------------------------------------------------
-- user_preferences
-- preferred_activities, preferred_location_ids and notify_in_app are feature
-- extensions. They are not on the UserPreferences contract yet.
-- notify_in_app is a stored preference only. This migration does not send
-- email or push notifications.
-- ---------------------------------------------------------------------------

create table public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  goal public.fitness_goal not null,
  preferred_days smallint[] not null default '{}',
  preferred_times_of_day public.time_of_day[] not null default '{}',
  sessions_per_week smallint not null check (sessions_per_week between 1 and 7),
  max_session_minutes smallint not null check (max_session_minutes between 10 and 180),
  timezone text not null default 'Asia/Kolkata',
  reminders_enabled boolean not null default false,
  preferred_activities text[] not null default '{}',
  preferred_location_ids uuid[] not null default '{}',
  notify_in_app boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_days_check check (
    preferred_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  constraint user_preferences_activities_check check (
    preferred_activities <@ array[
      'run',
      'walk_run',
      'walk',
      'strength',
      'conditioning',
      'mobility',
      'cross_training'
    ]::text[]
  )
);

comment on table public.user_preferences is
  'Runner scheduling preferences. preferred_activities, preferred_location_ids and notify_in_app are not yet in the shared UserPreferences contract.';

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- coach_assignments: who a coach or mentor may see
-- ---------------------------------------------------------------------------

create table public.coach_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  runner_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (coach_id, runner_id),
  constraint coach_assignments_distinct check (coach_id <> runner_id)
);

comment on table public.coach_assignments is
  'Links a coach or mentor to a runner. Required before that staff member can read the runner profile or assigned feedback.';

create index coach_assignments_runner_idx on public.coach_assignments (runner_id);
create index coach_assignments_coach_idx on public.coach_assignments (coach_id);

create function private.coach_assignment_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = new.coach_id
      and ur.role in ('coach', 'mentor', 'programme_manager', 'admin')
  ) then
    raise exception 'Assignee must be staff' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = new.runner_id
      and ur.role = 'runner'
  ) then
    raise exception 'Runner role required' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger coach_assignments_roles
  before insert or update on public.coach_assignments
  for each row execute function private.coach_assignment_roles();

-- ---------------------------------------------------------------------------
-- feedback and replies
-- barrier is a feature extension. It is not on the RunnerFeedback contract.
-- ---------------------------------------------------------------------------

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  target public.feedback_target not null,
  target_id uuid,
  rating smallint check (rating is null or rating between 1 and 5),
  body text not null check (char_length(body) between 1 and 2000),
  status public.feedback_status not null default 'new',
  barrier text not null check (
    barrier in ('consistency', 'schedule_conflicts', 'programme', 'motivation', 'other')
  ),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.feedback.barrier is
  'Participation barrier. Not yet a shared contract enum. Allowed: consistency, schedule_conflicts, programme, motivation, other.';

create index feedback_user_idx on public.feedback (user_id, created_at desc);
create index feedback_assigned_idx on public.feedback (assigned_to);
create index feedback_status_idx on public.feedback (status);

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function private.set_updated_at();

create function private.feedback_assignment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = new.assigned_to
      and ur.role in ('coach', 'mentor', 'programme_manager', 'admin')
  ) then
    raise exception 'Feedback can only be assigned to staff' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger feedback_assignment_guard
  before insert or update on public.feedback
  for each row execute function private.feedback_assignment_guard();

create table public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.feedback_replies is
  'Authorized replies on a feedback row. Not yet a shared contract.';

create index feedback_replies_feedback_idx on public.feedback_replies (feedback_id, created_at);

create function private.acknowledge_feedback_on_staff_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.user_roles ur
    where ur.user_id = new.author_id
      and ur.role in ('coach', 'mentor', 'programme_manager', 'admin')
  ) then
    update public.feedback
    set status = 'acknowledged'
    where id = new.feedback_id
      and status = 'new';
  end if;
  return new;
end;
$$;

create trigger feedback_replies_acknowledge
  after insert on public.feedback_replies
  for each row execute function private.acknowledge_feedback_on_staff_reply();

-- ---------------------------------------------------------------------------
-- announcements, read state, location updates, messages
-- ---------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete restrict,
  audience public.announcement_audience not null,
  audience_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  publish_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_publish_idx on public.announcements (publish_at desc);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function private.set_updated_at();

create table public.announcement_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

comment on table public.announcement_reads is
  'Per-user read state for announcements. Not yet a shared contract.';

create table public.location_updates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  publish_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.location_updates is
  'Location-specific notices. Reuses locations; not a second location model and not yet a shared contract.';

create index location_updates_location_idx on public.location_updates (location_id, publish_at desc);

create trigger location_updates_set_updated_at
  before update on public.location_updates
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint messages_distinct check (sender_id <> recipient_id)
);

comment on table public.messages is
  'Append-only in-app notes. No email or push is sent from this table.';

create index messages_sender_idx on public.messages (sender_id, created_at desc);
create index messages_recipient_idx on public.messages (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.announcement_visible(
  audience public.announcement_audience,
  publish_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.has_role('programme_manager')) or (select private.has_role('admin')) then true
    when publish_at > now() then false
    when audience = 'everyone' then true
    when audience in ('programme', 'coach_group') then (select private.is_staff())
    else false
  end;
$$;

comment on function private.announcement_visible(public.announcement_audience, timestamptz) is
  'Programme-scoped announcements stay staff-only until enrollments exist.';

create function private.can_message(recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    recipient is not null
    and recipient is distinct from (select auth.uid())
    and (select auth.uid()) is not null
    and (
      (select private.has_role('programme_manager'))
      or (select private.has_role('admin'))
      or exists (
        select 1
        from public.coach_assignments ca
        where ca.coach_id = (select auth.uid())
          and ca.runner_id = recipient
      )
      or exists (
        select 1
        from public.coach_assignments ca
        where ca.runner_id = (select auth.uid())
          and ca.coach_id = recipient
      )
      or exists (
        select 1
        from public.user_roles ur
        where ur.user_id = recipient
          and ur.role in ('programme_manager', 'admin')
      )
    );
$$;

create function public.list_message_recipients()
returns table (id uuid, display_name text, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, ur.role
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  where (select auth.uid()) is not null
    and (select private.can_message(p.id))
  order by p.display_name, ur.role;
$$;

revoke all on function private.announcement_visible(public.announcement_audience, timestamptz) from public;
revoke all on function private.can_message(uuid) from public;
revoke all on function public.list_message_recipients() from public, anon, authenticated;

grant execute on function private.announcement_visible(public.announcement_audience, timestamptz) to authenticated;
grant execute on function private.can_message(uuid) to authenticated;
grant execute on function public.list_message_recipients() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.user_preferences, public.coach_assignments, public.feedback, public.feedback_replies,
  public.announcements, public.announcement_reads, public.location_updates, public.messages
  from anon, authenticated;

grant select, insert on public.user_preferences to authenticated;
grant update (
  goal,
  preferred_days,
  preferred_times_of_day,
  sessions_per_week,
  max_session_minutes,
  timezone,
  reminders_enabled,
  preferred_activities,
  preferred_location_ids,
  notify_in_app
) on public.user_preferences to authenticated;

grant select, insert, delete on public.coach_assignments to authenticated;

grant select, insert on public.feedback to authenticated;
grant update (status, assigned_to) on public.feedback to authenticated;

grant select, insert on public.feedback_replies to authenticated;

grant select, insert on public.announcements to authenticated;
grant update (title, body, audience, audience_id, publish_at) on public.announcements to authenticated;

grant select, insert on public.announcement_reads to authenticated;

grant select, insert on public.location_updates to authenticated;
grant update (location_id, title, body, publish_at) on public.location_updates to authenticated;

grant select, insert on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.user_preferences enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.feedback enable row level security;
alter table public.feedback_replies enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.location_updates enable row level security;
alter table public.messages enable row level security;

create policy "user_preferences: read own"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_preferences: coaches read assigned"
  on public.user_preferences for select to authenticated
  using (
    exists (
      select 1
      from public.coach_assignments ca
      where ca.runner_id = user_id
        and ca.coach_id = (select auth.uid())
    )
  );

create policy "user_preferences: managers read all"
  on public.user_preferences for select to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "user_preferences: insert own"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_preferences: update own"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "coach_assignments: participants read"
  on public.coach_assignments for select to authenticated
  using (
    coach_id = (select auth.uid())
    or runner_id = (select auth.uid())
    or (select private.has_role('programme_manager'))
    or (select private.has_role('admin'))
  );

create policy "coach_assignments: managers insert"
  on public.coach_assignments for insert to authenticated
  with check (
    ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
    and assigned_by = (select auth.uid())
  );

create policy "coach_assignments: managers delete"
  on public.coach_assignments for delete to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "profiles: coaches read assigned"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.coach_assignments ca
      -- Qualified: a bare "id" would resolve to ca.id.
      where ca.runner_id = profiles.id
        and ca.coach_id = (select auth.uid())
    )
  );

create policy "feedback: read visible"
  on public.feedback for select to authenticated
  using (
    user_id = (select auth.uid())
    or assigned_to = (select auth.uid())
    or (select private.has_role('programme_manager'))
    or (select private.has_role('admin'))
  );

create policy "feedback: insert own"
  on public.feedback for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'new'
    and assigned_to is null
  );

create policy "feedback: managers update"
  on public.feedback for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "feedback_replies: read with parent"
  on public.feedback_replies for select to authenticated
  using (
    exists (
      select 1
      from public.feedback f
      where f.id = feedback_id
        and (
          f.user_id = (select auth.uid())
          or f.assigned_to = (select auth.uid())
          or (select private.has_role('programme_manager'))
          or (select private.has_role('admin'))
        )
    )
  );

create policy "feedback_replies: insert authorized"
  on public.feedback_replies for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1
      from public.feedback f
      where f.id = feedback_id
        and (
          f.user_id = (select auth.uid())
          or f.assigned_to = (select auth.uid())
          or (select private.has_role('programme_manager'))
          or (select private.has_role('admin'))
        )
    )
  );

create policy "announcements: read visible"
  on public.announcements for select to authenticated
  using ((select private.announcement_visible(audience, publish_at)));

create policy "announcements: managers insert"
  on public.announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  );

create policy "announcements: managers update"
  on public.announcements for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "announcement_reads: read own"
  on public.announcement_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy "announcement_reads: insert own"
  on public.announcement_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.announcements a
      where a.id = announcement_id
        and (select private.announcement_visible(a.audience, a.publish_at))
    )
  );

create policy "location_updates: read published"
  on public.location_updates for select to authenticated
  using (
    publish_at <= now()
    or (select private.has_role('programme_manager'))
    or (select private.has_role('admin'))
  );

create policy "location_updates: managers insert"
  on public.location_updates for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  );

create policy "location_updates: managers update"
  on public.location_updates for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "messages: participants read"
  on public.messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (select private.has_role('programme_manager'))
    or (select private.has_role('admin'))
  );

create policy "messages: send allowed"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select private.can_message(recipient_id))
  );
