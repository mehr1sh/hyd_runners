-- Planning: timetable uploads, availability, approved weekly plans and their sessions.
-- Owner: Planning (scheduler). Mirrors src/lib/contracts (AvailabilityBlock,
-- TimetableUpload, PlannedWorkout) and src/features/scheduler/logic/types.ts.
--
-- Conventions follow the foundation migration: UUID keys, timestamptz in UTC,
-- recurring availability as weekday + local `time`, RLS on every table,
-- grants start from nothing.

-- ---------------------------------------------------------------------------
-- Enums (mirror src/lib/contracts/index.ts)
-- ---------------------------------------------------------------------------

create type public.availability_kind as enum ('busy', 'free');
create type public.availability_source as enum ('manual', 'ai', 'text_parser');
create type public.timetable_upload_status as enum ('uploaded', 'processing', 'needs_review', 'confirmed', 'failed');

-- WorkoutType and PlannedWorkoutStatus are shared with Training. Create them
-- only if another area's migration has not already done so.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'workout_type' and typnamespace = 'public'::regnamespace) then
    create type public.workout_type as enum (
      'run', 'walk_run', 'walk', 'strength', 'conditioning', 'mobility', 'cross_training', 'rest'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'planned_workout_status' and typnamespace = 'public'::regnamespace) then
    create type public.planned_workout_status as enum ('planned', 'completed', 'missed', 'rescheduled', 'skipped');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- timetable_uploads: one row per file in the private `timetables` bucket.
-- Extracted contents are never stored here; only confirmed availability is.
-- ---------------------------------------------------------------------------

create table public.timetable_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  status public.timetable_upload_status not null default 'uploaded',
  method public.availability_source,
  error_code text check (error_code is null or char_length(error_code) <= 64),
  ai_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Paths are `{userId}/{uuid}.{ext}` so Storage policies can scope by folder.
  constraint timetable_uploads_path_in_user_folder check (storage_path like user_id::text || '/%')
);

create index timetable_uploads_user_id_idx on public.timetable_uploads (user_id, created_at desc);

create trigger timetable_uploads_set_updated_at
  before update on public.timetable_uploads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- availability_blocks: confirmed recurring weekly availability (AvailabilityBlock)
-- ---------------------------------------------------------------------------

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  kind public.availability_kind not null,
  label text check (label is null or char_length(label) <= 80),
  source public.availability_source not null default 'manual',
  source_upload_id uuid references public.timetable_uploads (id) on delete set null,
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  -- Blocks never cross midnight; overnight periods are two rows (see scheduler README).
  constraint availability_blocks_end_after_start check (end_time > start_time)
);

create index availability_blocks_user_weekday_idx on public.availability_blocks (user_id, weekday);
create index availability_blocks_source_upload_id_idx on public.availability_blocks (source_upload_id);

-- ---------------------------------------------------------------------------
-- weekly_plans: an approved week. Proposals are not stored until approved.
-- ---------------------------------------------------------------------------

create table public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'approved' check (status in ('approved', 'superseded')),
  source text not null check (source in ('deterministic', 'ai_assisted')),
  -- PlannerSettings snapshot used to generate the plan (goal, level, limits, preferences).
  settings jsonb not null,
  approved_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one approved plan per runner per week; repeated approvals cannot duplicate it.
create unique index weekly_plans_one_approved_per_week
  on public.weekly_plans (user_id, week_start)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- scheduled_workouts: dated sessions of a plan (PlannedWorkout)
-- ---------------------------------------------------------------------------

create table public.scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plan_id uuid references public.weekly_plans (id) on delete cascade,
  -- Training's enrollments / programme_sessions tables do not exist yet; FKs are added with them.
  enrollment_id uuid,
  programme_session_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  workout_type public.workout_type not null check (workout_type <> 'rest'),
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 300),
  status public.planned_workout_status not null default 'planned',
  planned_by text not null check (planned_by in ('scheduler', 'runner', 'coach')),
  rationale text[] not null default '{}',
  rescheduled_from uuid references public.scheduled_workouts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scheduled_workouts_user_starts_idx on public.scheduled_workouts (user_id, starts_at);
create index scheduled_workouts_plan_id_idx on public.scheduled_workouts (plan_id);
create index scheduled_workouts_rescheduled_from_idx on public.scheduled_workouts (rescheduled_from);

create trigger scheduled_workouts_set_updated_at
  before update on public.scheduled_workouts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_calls: per-user AI usage, for AI_DAILY_CALL_LIMIT and diagnostics.
-- Holds outcome and latency only, never prompts, files or model output.
-- ---------------------------------------------------------------------------

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  feature text not null check (feature in ('timetable_extraction', 'schedule_suggestion')),
  outcome text not null check (outcome in ('success', 'failed', 'rejected')),
  error_kind text check (error_kind is null or char_length(error_kind) <= 40),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index ai_calls_user_created_idx on public.ai_calls (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.timetable_uploads, public.availability_blocks, public.weekly_plans,
  public.scheduled_workouts, public.ai_calls from anon, authenticated;

grant select, delete on public.timetable_uploads to authenticated;
grant insert (storage_path, mime_type, size_bytes) on public.timetable_uploads to authenticated;
grant update (status, method, error_code, ai_attempted_at) on public.timetable_uploads to authenticated;

grant select, insert, delete on public.availability_blocks to authenticated;

grant select on public.weekly_plans to authenticated;
grant insert (week_start, timezone, source, settings) on public.weekly_plans to authenticated;
grant update (status, superseded_at) on public.weekly_plans to authenticated;

grant select, delete on public.scheduled_workouts to authenticated;
grant insert (plan_id, title, workout_type, starts_at, duration_minutes, planned_by, rationale, rescheduled_from)
  on public.scheduled_workouts to authenticated;
grant update (status) on public.scheduled_workouts to authenticated;

grant select on public.ai_calls to authenticated;
grant insert (feature, outcome, error_kind, latency_ms) on public.ai_calls to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: every row belongs to one runner. Coach visibility is
-- added with coach_assignments (Community).
-- ---------------------------------------------------------------------------

alter table public.timetable_uploads enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.weekly_plans enable row level security;
alter table public.scheduled_workouts enable row level security;
alter table public.ai_calls enable row level security;

create policy "timetable_uploads: own rows" on public.timetable_uploads
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "availability_blocks: own rows" on public.availability_blocks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "weekly_plans: own rows" on public.weekly_plans
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A session may only point at the runner's own plan.
create policy "scheduled_workouts: own rows" on public.scheduled_workouts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (plan_id is null or exists (
      select 1 from public.weekly_plans p where p.id = plan_id and p.user_id = (select auth.uid())
    ))
  );

create policy "ai_calls: read own" on public.ai_calls
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "ai_calls: insert own" on public.ai_calls
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Transactional helpers. SECURITY INVOKER, so RLS and grants above still apply;
-- they exist only because the Data API has no multi-statement transactions.
-- ---------------------------------------------------------------------------

-- Replace the caller's availability with an already-validated set.
create function public.replace_availability(p_blocks jsonb, p_source_upload_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  delete from public.availability_blocks where user_id = (select auth.uid());

  insert into public.availability_blocks (weekday, start_time, end_time, kind, label, source, source_upload_id, confidence)
  select b.weekday, b.start_time, b.end_time, b.kind, b.label, b.source, p_source_upload_id, b.confidence
  from jsonb_to_recordset(p_blocks) as b(
    weekday smallint, start_time time, end_time time, kind public.availability_kind,
    label text, source public.availability_source, confidence numeric
  );
  get diagnostics inserted = row_count;

  if p_source_upload_id is not null then
    update public.timetable_uploads set status = 'confirmed', error_code = null where id = p_source_upload_id;
  end if;
  return inserted;
end;
$$;

-- Save an approved plan and its sessions. Raises unique_violation (23505)
-- when the week already has an approved plan and p_replace is false.
create function public.approve_weekly_plan(
  p_week_start date,
  p_timezone text,
  p_source text,
  p_settings jsonb,
  p_sessions jsonb,
  p_replace boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select id into existing_id
  from public.weekly_plans
  where user_id = (select auth.uid()) and week_start = p_week_start and status = 'approved'
  for update;

  if existing_id is not null then
    if not p_replace then
      raise exception 'an approved plan already exists for this week' using errcode = '23505';
    end if;
    update public.weekly_plans set status = 'superseded', superseded_at = now() where id = existing_id;
    -- Sessions still to come are withdrawn; completed or missed ones stay as history.
    delete from public.scheduled_workouts where plan_id = existing_id and status = 'planned';
  end if;

  insert into public.weekly_plans (week_start, timezone, source, settings)
  values (p_week_start, p_timezone, p_source, p_settings)
  returning id into new_id;

  insert into public.scheduled_workouts (plan_id, title, workout_type, starts_at, duration_minutes, planned_by, rationale)
  select new_id, s.title, s.workout_type, s.starts_at, s.duration_minutes, s.planned_by, s.rationale
  from jsonb_to_recordset(p_sessions) as s(
    title text, workout_type public.workout_type, starts_at timestamptz,
    duration_minutes integer, planned_by text, rationale text[]
  );

  return new_id;
end;
$$;

-- Move a planned or missed session: the original becomes `rescheduled` and a
-- new planned row points back to it. Raises no_data_found (P0002) when the
-- session is not the caller's or cannot be moved.
create function public.reschedule_workout(p_workout_id uuid, p_starts_at timestamptz, p_rationale text[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  original public.scheduled_workouts;
  new_id uuid;
begin
  update public.scheduled_workouts
  set status = 'rescheduled'
  where id = p_workout_id and user_id = (select auth.uid()) and status in ('planned', 'missed')
  returning * into original;

  if original.id is null then
    raise exception 'session not found or cannot be moved' using errcode = 'P0002';
  end if;

  insert into public.scheduled_workouts (
    plan_id, title, workout_type, starts_at, duration_minutes, planned_by, rationale, rescheduled_from
  )
  values (
    original.plan_id, original.title, original.workout_type, p_starts_at, original.duration_minutes,
    'runner', p_rationale, original.id
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.replace_availability(jsonb, uuid) from public, anon;
revoke all on function public.approve_weekly_plan(date, text, text, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.reschedule_workout(uuid, timestamptz, text[]) from public, anon;
grant execute on function public.replace_availability(jsonb, uuid) to authenticated;
grant execute on function public.approve_weekly_plan(date, text, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.reschedule_workout(uuid, timestamptz, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `timetables` bucket, one folder per runner.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('timetables', 'timetables', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "timetables: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'timetables' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "timetables: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'timetables' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "timetables: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'timetables' and (storage.foldername(name))[1] = (select auth.uid())::text);
