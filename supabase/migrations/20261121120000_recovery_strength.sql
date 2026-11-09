-- Recovery journal, strength logs and return-to-running.
--
-- * recovery_entries: voluntary daily self-reports (every field optional),
--   owner-only. A runner may share an entry with their currently assigned
--   coach (share_with_coach); revoking the assignment or the role removes
--   that access at once because the policy calls private.is_active_coach.
-- * strength_logs: completed strength and mobility sessions with the
--   exercises done (catalogue keys validated by the app). Owner-only, plus
--   the assigned coach (training history, not health data).
-- * training_proposals gain the 'return_to_run' kind.

create table public.recovery_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  entry_date date not null,
  sleep_quality smallint check (sleep_quality between 1 and 5),
  sleep_hours numeric(3, 1) check (sleep_hours between 0 and 16),
  fatigue smallint check (fatigue between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  soreness_areas text[] not null default '{}' check (cardinality(soreness_areas) <= 13),
  stress smallint check (stress between 1 and 5),
  energy smallint check (energy between 1 and 5),
  workout_rpe smallint check (workout_rpe between 1 and 10),
  recovery_activities text[] not null default '{}' check (
    recovery_activities <@ array['stretching', 'foam_rolling', 'mobility', 'massage', 'yoga', 'walk', 'rest', 'other']::text[]
  ),
  notes text check (notes is null or char_length(notes) <= 500),
  share_with_coach boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date),
  constraint recovery_entries_not_empty check (
    sleep_quality is not null or sleep_hours is not null or fatigue is not null or soreness is not null
    or stress is not null or energy is not null or workout_rpe is not null
    or cardinality(recovery_activities) > 0 or notes is not null
  )
);
create trigger recovery_entries_updated_at before update on public.recovery_entries
  for each row execute function private.set_updated_at();

create function private.recovery_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.enforce_rate_limit('recovery_entry', 60, interval '1 day');
  end if;
  if new.entry_date > current_date + 1 or new.entry_date < current_date - 60 then
    raise exception 'entries can be for the last 60 days' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger recovery_entries_guard before insert or update on public.recovery_entries
  for each row execute function private.recovery_entries_guard();

alter table public.recovery_entries enable row level security;
revoke all on public.recovery_entries from anon, authenticated;
grant select, delete on public.recovery_entries to authenticated;
grant insert (id, user_id, entry_date, sleep_quality, sleep_hours, fatigue, soreness, soreness_areas, stress, energy,
              workout_rpe, recovery_activities, notes, share_with_coach) on public.recovery_entries to authenticated;
grant update (sleep_quality, sleep_hours, fatigue, soreness, soreness_areas, stress, energy, workout_rpe,
              recovery_activities, notes, share_with_coach) on public.recovery_entries to authenticated;
create policy "recovery_entries: owner" on public.recovery_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "recovery_entries: shared with current coach" on public.recovery_entries for select to authenticated
  using (share_with_coach and (select private.is_active_coach((select auth.uid()), user_id)));

-- Strength logs ---------------------------------------------------------------

create table public.strength_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  performed_on date not null,
  title text not null check (char_length(title) between 1 and 120),
  session_key text check (session_key is null or session_key ~ '^[a-z_]{1,40}$'),
  minutes smallint not null check (minutes between 5 and 180),
  -- [{ "key": "glute_bridge", "sets": 3, "reps": 12 } | { ..., "seconds": 30 }]
  exercises jsonb not null check (jsonb_typeof(exercises) = 'array' and jsonb_array_length(exercises) between 1 and 30),
  scheduled_workout_id uuid references public.scheduled_workouts (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now()
);
create index strength_logs_user_idx on public.strength_logs (user_id, performed_on desc);

create function private.strength_logs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('strength_log', 30, interval '1 day');
  if new.performed_on > current_date + 1 or new.performed_on < current_date - 60 then
    raise exception 'logs can be for the last 60 days' using errcode = '22023';
  end if;
  if new.scheduled_workout_id is not null and not exists (
    select 1 from public.scheduled_workouts w where w.id = new.scheduled_workout_id and w.user_id = new.user_id) then
    raise exception 'session not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger strength_logs_guard before insert on public.strength_logs
  for each row execute function private.strength_logs_guard();

alter table public.strength_logs enable row level security;
revoke all on public.strength_logs from anon, authenticated;
grant select, delete on public.strength_logs to authenticated;
grant insert (id, user_id, performed_on, title, session_key, minutes, exercises, scheduled_workout_id, notes)
  on public.strength_logs to authenticated;
create policy "strength_logs: owner" on public.strength_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "strength_logs: current coach reads" on public.strength_logs for select to authenticated
  using ((select private.is_active_coach((select auth.uid()), user_id)));

-- Return to running -------------------------------------------------------------

alter table public.training_proposals drop constraint training_proposals_kind_check;
alter table public.training_proposals add constraint training_proposals_kind_check
  check (kind in ('race_plan', 'missed_session', 'adaptive', 'coach', 'return_to_run'));
