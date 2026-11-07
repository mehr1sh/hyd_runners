-- Runner experience: workout logs, XP ledger, badges, weekly challenges,
-- leaderboard privacy and the weekly leaderboard function.
-- Owner: Runner experience (feat/runner-experience).
--
-- Security model: runners can READ their own rows. All writes go through
-- server code using the secret key (src/features/workouts/service.ts and
-- src/features/gamification/service.ts), which validates input and computes
-- rewards. Unique constraints make every write idempotent, so a repeated
-- completion request can never create a second workout or a second award.

-- ---------------------------------------------------------------------------
-- workout_logs: planned/started/completed workouts (CompletedWorkout contract)
-- ---------------------------------------------------------------------------

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  title text not null check (char_length(title) between 1 and 120),
  workout_type text not null
    check (workout_type in ('run', 'walk_run', 'walk', 'strength', 'conditioning', 'mobility', 'cross_training', 'rest')),
  programme_session_id uuid references public.programme_sessions (id) on delete set null,
  enrollment_id uuid references public.enrollments (id) on delete set null,
  -- Scheduler-owned planned workout (PlannedWorkout contract). No FK until the
  -- scheduler migration lands; see src/features/workouts/planned-source.ts.
  planned_workout_id uuid,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds between 60 and 21600),
  distance_meters integer check (distance_meters between 0 and 100000),
  perceived_effort integer check (perceived_effort between 1 and 10),
  location_id uuid references public.locations (id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  -- How the record was produced: live timer, manual entry, or simulated demo data.
  source text not null default 'manual' check (source in ('timer', 'manual', 'simulated')),
  -- Client-generated key; a retried request with the same key is a no-op.
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_logs_completed_fields check (
    status <> 'completed' or (completed_at is not null and duration_seconds is not null)
  ),
  constraint workout_logs_completed_after_start check (completed_at is null or completed_at >= started_at),
  constraint workout_logs_session_needs_enrollment check (programme_session_id is null or enrollment_id is not null)
);

create unique index workout_logs_idempotency on public.workout_logs (user_id, idempotency_key);
-- At most one workout in progress per runner.
create unique index workout_logs_one_in_progress on public.workout_logs (user_id) where status = 'in_progress';
-- A programme session or planned workout can be completed only once.
create unique index workout_logs_session_once
  on public.workout_logs (enrollment_id, programme_session_id)
  where status = 'completed' and programme_session_id is not null;
create unique index workout_logs_planned_once
  on public.workout_logs (user_id, planned_workout_id)
  where status = 'completed' and planned_workout_id is not null;
create index workout_logs_user_started on public.workout_logs (user_id, started_at desc);

create trigger workout_logs_set_updated_at
  before update on public.workout_logs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gamification
-- ---------------------------------------------------------------------------

create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta_xp integer not null,
  delta_coins integer not null default 0,
  reason text not null check (reason in (
    'workout_completed', 'planned_workout_on_time', 'streak_milestone', 'badge_earned',
    'event_attended', 'feedback_submitted', 'admin_adjustment'
  )),
  ref_table text,
  ref_id uuid,
  -- Deterministic key for the rule that produced the award, e.g.
  -- 'workout:day:2026-10-14' or 'badge:first-workout'. Unique per runner.
  award_key text not null,
  -- When the earning event happened (used for weekly leaderboards).
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, award_key)
);

create index xp_ledger_user_idx on public.xp_ledger (user_id, occurred_at desc);
create index xp_ledger_occurred_idx on public.xp_ledger (occurred_at);

create table public.badges (
  code text primary key check (code ~ '^[a-z0-9-]+$'),
  title text not null,
  description text not null,
  xp_reward integer not null default 0 check (xp_reward >= 0),
  coins_reward integer not null default 0 check (coins_reward >= 0),
  sort_order integer not null default 100
);

create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_code text not null references public.badges (code) on delete cascade,
  earned_at timestamptz not null,
  primary key (user_id, badge_code)
);

create table public.challenge_completions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_code text not null check (challenge_code ~ '^[a-z0-9-]+$'),
  week_start date not null,
  completed_at timestamptz not null,
  primary key (user_id, challenge_code, week_start)
);

-- Per-runner privacy for community features.
create table public.runner_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  show_on_leaderboard boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger runner_settings_set_updated_at
  before update on public.runner_settings
  for each row execute function private.set_updated_at();

-- Badge catalogue. Rules live in src/features/gamification/logic/badges.ts;
-- codes and rewards here must match that file.
insert into public.badges (code, title, description, xp_reward, coins_reward, sort_order) values
  ('first-workout', 'First steps', 'Completed your first workout.', 20, 5, 10),
  ('workouts-5', 'Five and thriving', 'Completed 5 workouts.', 30, 10, 20),
  ('workouts-25', 'Twenty-five strong', 'Completed 25 workouts.', 75, 25, 30),
  ('workouts-50', 'Half-century', 'Completed 50 workouts.', 150, 50, 40),
  ('streak-7', 'Week-long habit', 'Reached a 7-day habit streak.', 40, 10, 50),
  ('weekly-streak-4', 'Four steady weeks', 'Met your weekly goal 4 weeks in a row.', 80, 20, 60),
  ('c25k-week-1', 'Week 1 done', 'Finished week 1 of Couch to 5K.', 25, 5, 70),
  ('c25k-halfway', 'Halfway there', 'Finished week 5 of Couch to 5K, including your first 20-minute run.', 60, 15, 80),
  ('c25k-graduate', 'Couch to 5K graduate', 'Finished all nine weeks of Couch to 5K.', 200, 50, 90),
  ('programme-complete', 'Programme finisher', 'Completed every session of a programme.', 100, 25, 100),
  ('distance-5k', '5 km covered', 'Ran or walk-ran 5 km in total.', 25, 5, 110),
  ('distance-42k', 'Marathon in pieces', 'Ran or walk-ran 42.2 km in total.', 100, 25, 120),
  ('all-rounder', 'All-rounder', 'Logged running, strength and mobility work.', 40, 10, 130),
  ('early-bird', 'Early bird', 'Started a workout before 7:00.', 15, 5, 140),
  ('challenges-3', 'Challenge accepted', 'Completed 3 weekly challenges.', 50, 15, 150),
  ('community-first-rsvp', 'Joined a group run', 'Signed up for your first community event.', 10, 0, 160);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on public.workout_logs, public.xp_ledger, public.badges, public.user_badges,
  public.challenge_completions, public.runner_settings from anon, authenticated;

grant select on public.workout_logs, public.xp_ledger, public.user_badges, public.challenge_completions to authenticated;
grant select on public.badges to anon, authenticated;
-- user_id is included because upserts re-assign it; the policy keeps it fixed to the caller.
grant select, insert, update (user_id, show_on_leaderboard) on public.runner_settings to authenticated;

alter table public.workout_logs enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.challenge_completions enable row level security;
alter table public.runner_settings enable row level security;

create policy "workout_logs: read own" on public.workout_logs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "xp_ledger: read own" on public.xp_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "badges: anyone reads" on public.badges for select to anon, authenticated
  using (true);
create policy "user_badges: read own" on public.user_badges for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "challenge_completions: read own" on public.challenge_completions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "runner_settings: read own" on public.runner_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "runner_settings: create own" on public.runner_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "runner_settings: update own" on public.runner_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Weekly leaderboard: XP earned in a local (default Asia/Kolkata) Mon–Sun
-- week. Exposes display names only, never ids, emails or locations, and
-- hides runners who opted out (except the caller, who always sees their row).
-- ---------------------------------------------------------------------------

create function public.weekly_leaderboard(
  p_week_start date,
  p_timezone text default 'Asia/Kolkata',
  p_limit integer default 20
)
returns table (rank bigint, display_name text, xp bigint, workouts bigint, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (p_week_start::timestamp at time zone p_timezone) as from_ts,
           ((p_week_start + 7)::timestamp at time zone p_timezone) as to_ts
  ),
  totals as (
    select l.user_id,
           sum(l.delta_xp)::bigint as xp,
           count(*) filter (where l.reason = 'workout_completed')::bigint as workouts
    from public.xp_ledger l, bounds b
    where l.occurred_at >= b.from_ts and l.occurred_at < b.to_ts
    group by l.user_id
    having sum(l.delta_xp) > 0
  ),
  visible as (
    select t.*, p.display_name
    from totals t
    join public.profiles p on p.id = t.user_id
    left join public.runner_settings s on s.user_id = t.user_id
    where coalesce(s.show_on_leaderboard, true) or t.user_id = (select auth.uid())
  ),
  ranked as (
    select rank() over (order by v.xp desc) as rank, v.display_name, v.xp, v.workouts,
           v.user_id = (select auth.uid()) as is_me
    from visible v
  )
  select r.rank, r.display_name, r.xp, r.workouts, r.is_me
  from ranked r
  where r.rank <= greatest(1, least(p_limit, 100)) or r.is_me
  order by r.rank, r.display_name;
$$;

revoke all on function public.weekly_leaderboard(date, text, integer) from public, anon;
grant execute on function public.weekly_leaderboard(date, text, integer) to authenticated;
