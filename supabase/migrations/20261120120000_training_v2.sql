-- Adaptive training and race preparation.
--
-- * race_goals: one active goal per runner (5K, 10K, half, marathon), with an
--   optional target time and event link. Owner-only.
-- * scheduled_workouts gain structured details (warm-up, main set, cool-down,
--   intensity) and the race goal they belong to.
-- * training_proposals: changes to the runner's schedule (a race plan, a
--   missed-session recovery or an adaptive adjustment) that only take effect
--   when the runner accepts them, optionally leaving out some changes.
--   decide_training_proposal() applies the accepted changes atomically with
--   the runner's own rights; nothing modifies a plan silently.

create table public.race_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  distance text not null check (distance in ('5k', '10k', 'half', 'marathon')),
  race_date date not null,
  name text check (name is null or char_length(name) between 1 and 120),
  event_id uuid references public.events (id) on delete set null,
  target_seconds integer check (target_seconds is null or target_seconds between 600 and 36000),
  current_level public.fitness_level not null,
  days_per_week smallint not null check (days_per_week between 2 and 6),
  long_run_day smallint not null default 7 check (long_run_day between 1 and 7),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index race_goals_one_active on public.race_goals (user_id) where status = 'active';
create index race_goals_user_idx on public.race_goals (user_id, race_date desc);
create trigger race_goals_updated_at before update on public.race_goals
  for each row execute function private.set_updated_at();

create function private.race_goals_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.enforce_rate_limit('race_goal', 20, interval '1 day');
    if new.race_date < current_date or new.race_date > current_date + 366 then
      raise exception 'race date must be within the next year' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger race_goals_before_write before insert or update on public.race_goals
  for each row execute function private.race_goals_before_write();

alter table public.race_goals enable row level security;
revoke all on public.race_goals from anon, authenticated;
grant select, delete on public.race_goals to authenticated;
grant insert (id, user_id, distance, race_date, name, event_id, target_seconds, current_level, days_per_week, long_run_day)
  on public.race_goals to authenticated;
grant update (name, target_seconds, days_per_week, long_run_day, status) on public.race_goals to authenticated;
create policy "race_goals: owner" on public.race_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Structured sessions --------------------------------------------------------

alter table public.scheduled_workouts
  add column details jsonb check (details is null or (jsonb_typeof(details) = 'object' and pg_column_size(details) < 8000)),
  add column race_goal_id uuid references public.race_goals (id) on delete set null;
create index scheduled_workouts_race_goal_idx on public.scheduled_workouts (race_goal_id) where race_goal_id is not null;
grant insert (details, race_goal_id) on public.scheduled_workouts to authenticated;

-- Proposals -------------------------------------------------------------------

create table public.training_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  proposed_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('race_plan', 'missed_session', 'adaptive', 'coach')),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'superseded')),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null check (char_length(summary) between 1 and 1000),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 12),
  -- Ordered list of changes: add / move / shorten / cancel / mark_missed.
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 200),
  race_goal_id uuid references public.race_goals (id) on delete cascade,
  -- Which session (if any) prompted it, so the same missed session is not proposed twice.
  source_workout_id uuid references public.scheduled_workouts (id) on delete set null,
  applied_changes integer[],
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index training_proposals_user_idx on public.training_proposals (user_id, created_at desc);
create unique index training_proposals_one_per_source on public.training_proposals (source_workout_id)
  where source_workout_id is not null and kind = 'missed_session';

create function private.training_proposals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('training_proposal', 60, interval '1 day');
  new.status := 'proposed';
  new.decided_at := null;
  new.applied_changes := null;
  new.created_at := now();
  new.proposed_by := (select auth.uid());
  -- Only a coach can file a coach proposal (added with the coach platform).
  if new.kind = 'coach' then
    raise exception 'coach proposals are filed through the coach tools' using errcode = '42501';
  end if;
  -- A new proposal of the same kind replaces an undecided one.
  update public.training_proposals set status = 'superseded', decided_at = now()
   where user_id = new.user_id and kind = new.kind and status = 'proposed'
     and new.kind in ('race_plan', 'adaptive');
  return new;
end;
$$;
create trigger training_proposals_before_insert before insert on public.training_proposals
  for each row execute function private.training_proposals_before_insert();

alter table public.training_proposals enable row level security;
revoke all on public.training_proposals from anon, authenticated;
grant select on public.training_proposals to authenticated;
grant insert (id, user_id, kind, title, summary, reasons, changes, race_goal_id, source_workout_id)
  on public.training_proposals to authenticated;
create policy "training_proposals: runner reads" on public.training_proposals for select to authenticated
  using (user_id = (select auth.uid()));
create policy "training_proposals: runner proposes for themselves" on public.training_proposals for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Locks the caller's own proposal row (runners have no UPDATE grant, which
-- SELECT ... FOR UPDATE would need).
create function private.claim_proposal(p_id uuid)
returns setof public.training_proposals
language sql
security definer
set search_path = ''
as $$
  select * from public.training_proposals
   where id = p_id and user_id = (select auth.uid())
  for update;
$$;
revoke all on function private.claim_proposal(uuid) from public, anon;
grant execute on function private.claim_proposal(uuid) to authenticated;

-- Accept (all or some changes) or reject. Runs with the runner's own rights, so
-- every change is checked by the scheduled_workouts policies.
create function public.decide_training_proposal(p_id uuid, p_accept boolean, p_skip integer[] default '{}')
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prop public.training_proposals;
  c jsonb;
  i integer := 0;
  applied integer[] := '{}';
  touched integer;
  by_text text;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into prop from private.claim_proposal(p_id);
  if prop.id is null then
    raise exception 'proposal not found' using errcode = 'P0002';
  end if;
  if prop.status <> 'proposed' then
    raise exception 'proposal already decided' using errcode = '23505';
  end if;

  if not p_accept then
    perform private.set_proposal_status(p_id, 'rejected', null);
    return 0;
  end if;

  by_text := case when prop.kind = 'coach' then 'coach' else 'scheduler' end;
  for c in select value from jsonb_array_elements(prop.changes) loop
    i := i + 1;
    continue when i = any (coalesce(p_skip, '{}'));
    case c->>'op'
      when 'add' then
        insert into public.scheduled_workouts (title, workout_type, starts_at, duration_minutes, planned_by, rationale, details, race_goal_id)
        values (c->>'title', (c->>'workout_type')::public.workout_type, (c->>'starts_at')::timestamptz,
                (c->>'duration_minutes')::integer, by_text,
                coalesce(array(select jsonb_array_elements_text(c->'rationale')), '{}'),
                c->'details', prop.race_goal_id);
        touched := 1;
      when 'move' then
        perform public.reschedule_workout((c->>'workout_id')::uuid, (c->>'starts_at')::timestamptz,
          coalesce(array(select jsonb_array_elements_text(c->'rationale')), '{}'));
        touched := 1;
      when 'cancel' then
        update public.scheduled_workouts set status = 'skipped'
         where id = (c->>'workout_id')::uuid and user_id = (select auth.uid()) and status = 'planned';
        get diagnostics touched = row_count;
      when 'mark_missed' then
        update public.scheduled_workouts set status = 'missed'
         where id = (c->>'workout_id')::uuid and user_id = (select auth.uid()) and status = 'planned';
        get diagnostics touched = row_count;
      when 'shorten' then
        perform private.shorten_workout((c->>'workout_id')::uuid, (c->>'duration_minutes')::integer);
        touched := 1;
      else
        raise exception 'unknown change %', c->>'op' using errcode = '22023';
    end case;
    if touched = 0 then
      raise exception 'change % no longer applies; ask for a fresh proposal', i using errcode = 'P0002';
    end if;
    applied := applied || i;
  end loop;

  if cardinality(applied) = 0 then
    raise exception 'no changes selected' using errcode = '22023';
  end if;
  perform private.set_proposal_status(p_id, 'accepted', applied);
  return cardinality(applied);
end;
$$;
revoke all on function public.decide_training_proposal(uuid, boolean, integer[]) from public, anon;
grant execute on function public.decide_training_proposal(uuid, boolean, integer[]) to authenticated;

-- Status changes go through decide_training_proposal only (no update grant).
create function private.set_proposal_status(p_id uuid, p_status text, p_applied integer[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.training_proposals
     set status = p_status, decided_at = now(), applied_changes = p_applied
   where id = p_id and user_id = (select auth.uid()) and status = 'proposed';
$$;
revoke all on function private.set_proposal_status(uuid, text, integer[]) from public, anon;
grant execute on function private.set_proposal_status(uuid, text, integer[]) to authenticated;

-- Duration is not a runner-updatable column; shortening only ever reduces it.
create function private.shorten_workout(p_workout uuid, p_minutes integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scheduled_workouts
     set duration_minutes = p_minutes, updated_at = now()
   where id = p_workout and user_id = (select auth.uid()) and status = 'planned'
     and p_minutes between 5 and duration_minutes - 1;
  if not found then
    raise exception 'session cannot be shortened' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function private.shorten_workout(uuid, integer) from public, anon;
grant execute on function private.shorten_workout(uuid, integer) to authenticated;
