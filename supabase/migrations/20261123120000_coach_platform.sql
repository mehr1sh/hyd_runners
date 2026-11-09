-- Human coach platform and professional profiles.
--
-- Access always goes through private.is_active_coach(coach, runner): a
-- current assignment AND a current coach/mentor/manager/admin role, checked
-- on every call, so revoking either removes access at once (Release 0 rule).
--
-- * profiles.coach_sees_training: the runner's switch for whether assigned
--   coaches see training summaries (default on; never GPS, never private
--   journal entries unless shared per entry).
-- * coach_runner_list() / coach_runner_overview(): summaries for assigned
--   runners only.
-- * coach_notes + replies: workout feedback, progress notes and
--   recommendations, with runner replies. Sensitive actions are audited.
-- * coach_propose_changes(): coaches propose schedule changes as
--   training_proposals of kind 'coach'; only the runner can accept them.
-- * notifications: in-app notices, written only by database functions.
-- * professional_profiles: coach/physio profiles; verification status can be
--   changed only by admins (audited). Unverified is the default and is never
--   shown as verified.

-- Runner setting ---------------------------------------------------------------

alter table public.profiles add column coach_sees_training boolean not null default true;
grant update (coach_sees_training) on public.profiles to authenticated;

-- Notifications ------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  title text not null check (char_length(title) between 1 and 160),
  body text check (body is null or char_length(body) <= 500),
  href text check (href is null or (href ~ '^/[A-Za-z0-9/_?=&#.-]*$' and char_length(href) <= 300)),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "notifications: owner" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: owner marks read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: owner deletes" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_href text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  values (p_user, p_kind, left(p_title, 160), left(p_body, 500), p_href);
$$;
revoke all on function private.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Coach notes --------------------------------------------------------------------

create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  runner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('workout_feedback', 'progress_note', 'recommendation')),
  body text not null check (char_length(body) between 1 and 2000 and body = btrim(body)),
  scheduled_workout_id uuid references public.scheduled_workouts (id) on delete set null,
  activity_id uuid references public.activities (id) on delete set null,
  created_at timestamptz not null default now()
);
create index coach_notes_runner_idx on public.coach_notes (runner_id, created_at desc);
create index coach_notes_coach_idx on public.coach_notes (coach_id, created_at desc);

create table public.coach_note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.coach_notes (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000 and body = btrim(body)),
  created_at timestamptz not null default now()
);
create index coach_note_replies_note_idx on public.coach_note_replies (note_id, created_at);

create function private.coach_notes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('coach_note', 100, interval '1 day');
  new.coach_id := (select auth.uid());
  new.created_at := now();
  if not private.is_active_coach(new.coach_id, new.runner_id) then
    raise exception 'not this runner''s coach' using errcode = '42501';
  end if;
  if new.scheduled_workout_id is not null and not exists (
    select 1 from public.scheduled_workouts w where w.id = new.scheduled_workout_id and w.user_id = new.runner_id) then
    raise exception 'session not found' using errcode = '42501';
  end if;
  if new.activity_id is not null and not exists (
    select 1 from public.activities a where a.id = new.activity_id and a.user_id = new.runner_id) then
    raise exception 'activity not found' using errcode = '42501';
  end if;
  perform private.write_audit('coach.note', 'coach_note', new.id::text, new.runner_id, jsonb_build_object('kind', new.kind));
  perform private.notify(new.runner_id, 'coach_note',
    case new.kind when 'workout_feedback' then 'Your coach left feedback on a session'
                  when 'recommendation' then 'Your coach made a recommendation'
                  else 'Your coach added a progress note' end,
    left(new.body, 140), '/training#coach');
  return new;
end;
$$;
create trigger coach_notes_before_insert before insert on public.coach_notes
  for each row execute function private.coach_notes_before_insert();

create function private.coach_note_replies_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.coach_notes;
begin
  perform private.enforce_rate_limit('coach_note_reply', 100, interval '1 day');
  new.author_id := (select auth.uid());
  new.created_at := now();
  select * into n from public.coach_notes where id = new.note_id;
  if n.id is null or not (new.author_id = n.runner_id or private.is_active_coach(new.author_id, n.runner_id)) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if new.author_id = n.runner_id then
    perform private.notify(n.coach_id, 'coach_note_reply', 'A runner replied to your note', left(new.body, 140),
                           '/coach/runners/' || n.runner_id::text);
  else
    perform private.notify(n.runner_id, 'coach_note_reply', 'Your coach replied', left(new.body, 140), '/training#coach');
  end if;
  return new;
end;
$$;
create trigger coach_note_replies_before_insert before insert on public.coach_note_replies
  for each row execute function private.coach_note_replies_before_insert();

alter table public.coach_notes enable row level security;
alter table public.coach_note_replies enable row level security;
revoke all on public.coach_notes, public.coach_note_replies from anon, authenticated;
grant select on public.coach_notes, public.coach_note_replies to authenticated;
grant insert (id, runner_id, kind, body, scheduled_workout_id, activity_id) on public.coach_notes to authenticated;
grant insert (id, note_id, body) on public.coach_note_replies to authenticated;
create policy "coach_notes: runner or current coach reads" on public.coach_notes for select to authenticated
  using (runner_id = (select auth.uid()) or (select private.is_active_coach((select auth.uid()), runner_id)));
create policy "coach_notes: current coach writes" on public.coach_notes for insert to authenticated
  with check ((select private.is_active_coach((select auth.uid()), runner_id)));
create policy "coach_note_replies: thread participants read" on public.coach_note_replies for select to authenticated
  using (exists (select 1 from public.coach_notes n where n.id = note_id));
create policy "coach_note_replies: thread participants write" on public.coach_note_replies for insert to authenticated
  with check (exists (select 1 from public.coach_notes n where n.id = note_id));

-- Coach proposals ----------------------------------------------------------------

create or replace function private.training_proposals_before_insert()
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
  -- A coach proposal must come from the runner's current coach (through coach_propose_changes).
  if new.kind = 'coach' and not private.is_active_coach(new.proposed_by, new.user_id) then
    raise exception 'coach proposals are filed through the coach tools' using errcode = '42501';
  end if;
  update public.training_proposals set status = 'superseded', decided_at = now()
   where user_id = new.user_id and kind = new.kind and status = 'proposed'
     and new.kind in ('race_plan', 'adaptive');
  return new;
end;
$$;

-- Coaches see proposals they made, and return-to-running proposals of their runners.
create policy "training_proposals: current coach reads" on public.training_proposals for select to authenticated
  using ((proposed_by = (select auth.uid()) or kind = 'return_to_run')
         and (select private.is_active_coach((select auth.uid()), user_id)));

create function public.coach_propose_changes(
  p_runner uuid, p_title text, p_summary text, p_reasons text[], p_changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  new_id uuid;
begin
  if not private.is_active_coach((select auth.uid()), p_runner) then
    raise exception 'not this runner''s coach' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 50 then
    raise exception 'between 1 and 50 changes' using errcode = '22023';
  end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    if c->>'op' not in ('add', 'shorten', 'cancel', 'move') then
      raise exception 'unsupported change' using errcode = '22023';
    end if;
    if c->>'op' in ('shorten', 'cancel', 'move') and not exists (
      select 1 from public.scheduled_workouts w
       where w.id = (c->>'workout_id')::uuid and w.user_id = p_runner and w.status = 'planned') then
      raise exception 'session not found' using errcode = '22023';
    end if;
    if c->>'op' = 'add' and ((c->>'duration_minutes')::integer not between 5 and 300
                             or (c->>'starts_at')::timestamptz < now()) then
      raise exception 'invalid session' using errcode = '22023';
    end if;
  end loop;
  insert into public.training_proposals (user_id, kind, title, summary, reasons, changes)
  values (p_runner, 'coach', left(p_title, 120), left(p_summary, 1000), coalesce(p_reasons, '{}'), p_changes)
  returning id into new_id;
  perform private.write_audit('coach.propose', 'training_proposal', new_id::text, p_runner,
                              jsonb_build_object('changes', jsonb_array_length(p_changes)));
  perform private.notify(p_runner, 'coach_proposal', 'Your coach proposed changes to your plan', left(p_title, 140),
                         '/training');
  return new_id;
end;
$$;
revoke all on function public.coach_propose_changes(uuid, text, text, text[], jsonb) from public, anon;
grant execute on function public.coach_propose_changes(uuid, text, text, text[], jsonb) to authenticated;

-- Tell the coach when the runner decides on their proposal.
create function private.training_proposals_after_decide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'coach' and old.status = 'proposed' and new.status in ('accepted', 'rejected')
     and new.proposed_by is not null then
    perform private.notify(new.proposed_by, 'coach_proposal_decided',
      'A runner ' || new.status || ' your proposal', left(new.title, 140), '/coach/runners/' || new.user_id::text);
  end if;
  return new;
end;
$$;
create trigger training_proposals_after_decide after update on public.training_proposals
  for each row execute function private.training_proposals_after_decide();

-- Coach views --------------------------------------------------------------------

create function public.coach_runner_list()
returns table (
  runner_id uuid, display_name text, shares_training boolean, programme text,
  last_activity_at timestamptz, distance_7d_m numeric, planned_28d bigint, completed_28d bigint,
  open_proposals bigint, unread_replies bigint, race_goal text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.coach_sees_training,
         (select pr.title from public.enrollments e join public.programmes pr on pr.id = e.programme_id
           where e.user_id = p.id and e.status = 'active' order by e.started_at desc nulls last limit 1),
         case when p.coach_sees_training then
           (select max(a.started_at) from public.activities a where a.user_id = p.id and a.status = 'ready') end,
         case when p.coach_sees_training then
           (select coalesce(sum(a.distance_m), 0) from public.activities a
             where a.user_id = p.id and a.status = 'ready' and a.started_at >= now() - interval '7 days') end,
         case when p.coach_sees_training then
           (select count(*) from public.scheduled_workouts w where w.user_id = p.id and w.status not in ('rescheduled', 'skipped')
             and w.starts_at >= now() - interval '28 days' and w.starts_at < now()) end,
         case when p.coach_sees_training then
           (select count(*) from public.scheduled_workouts w where w.user_id = p.id and w.status = 'completed'
             and w.starts_at >= now() - interval '28 days' and w.starts_at < now()) end,
         (select count(*) from public.training_proposals t
           where t.user_id = p.id and t.proposed_by = (select auth.uid()) and t.status = 'proposed'),
         (select count(*) from public.coach_note_replies r join public.coach_notes n on n.id = r.note_id
           where n.runner_id = p.id and r.author_id = p.id and r.created_at > now() - interval '14 days'),
         case when p.coach_sees_training then
           (select g.distance || ' on ' || g.race_date from public.race_goals g where g.user_id = p.id and g.status = 'active') end
  from public.coach_assignments ca
  join public.profiles p on p.id = ca.runner_id
  where ca.coach_id = (select auth.uid())
    and private.is_active_coach((select auth.uid()), ca.runner_id)
  order by p.display_name;
$$;
revoke all on function public.coach_runner_list() from public, anon;
grant execute on function public.coach_runner_list() to authenticated;

-- One runner's training summary for their current coach. Never returns GPS,
-- activity tracks or private journal notes.
create function public.coach_runner_overview(p_runner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  tz text;
begin
  if not private.is_active_coach((select auth.uid()), p_runner) then
    raise exception 'not this runner''s coach' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_runner;
  tz := coalesce(p.timezone, 'Asia/Kolkata');
  if not p.coach_sees_training then
    return jsonb_build_object('displayName', p.display_name, 'sharesTraining', false);
  end if;
  return jsonb_build_object(
    'displayName', p.display_name,
    'sharesTraining', true,
    'timezone', tz,
    'fitnessLevel', p.fitness_level,
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('weekStart', wk, 'distanceM', d, 'runs', n, 'movingS', mv) order by wk)
      from (select date_trunc('week', a.started_at at time zone tz)::date wk, sum(a.distance_m) d, count(*) n,
                   sum(a.moving_seconds) mv
              from public.activities a
             where a.user_id = p_runner and a.status = 'ready' and a.started_at >= now() - interval '84 days'
             group by 1) w), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'startedAt', a.started_at, 'type', a.activity_type,
                                          'distanceM', a.distance_m, 'movingS', a.moving_seconds, 'paceS', a.avg_pace_s,
                                          'elevationM', a.elevation_gain_m) order by a.started_at desc)
      from (select * from public.activities a where a.user_id = p_runner and a.status = 'ready'
             order by a.started_at desc limit 20) a), '[]'::jsonb),
    'bestEfforts', coalesce((
      select jsonb_object_agg(k, s) from (
        select e.key k, min(e.value::integer) s from public.activities a, jsonb_each_text(a.best_efforts) e
         where a.user_id = p_runner and a.status = 'ready' group by e.key) b), '{}'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'type', w.workout_type, 'startsAt', w.starts_at,
                                          'minutes', w.duration_minutes, 'status', w.status, 'plannedBy', w.planned_by)
                       order by w.starts_at)
      from public.scheduled_workouts w
      where w.user_id = p_runner and w.status <> 'rescheduled'
        and w.starts_at >= now() - interval '14 days' and w.starts_at < now() + interval '21 days'), '[]'::jsonb),
    'raceGoal', (select jsonb_build_object('distance', g.distance, 'raceDate', g.race_date, 'targetSeconds', g.target_seconds,
                                           'name', g.name)
                   from public.race_goals g where g.user_id = p_runner and g.status = 'active'),
    'strength', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.performed_on, 'title', s.title, 'minutes', s.minutes) order by s.performed_on desc)
      from (select * from public.strength_logs s where s.user_id = p_runner order by performed_on desc limit 10) s), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.coach_runner_overview(uuid) from public, anon;
grant execute on function public.coach_runner_overview(uuid) to authenticated;

-- Professional profiles ------------------------------------------------------------

create table public.professional_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  profession text not null default 'running_coach'
    check (profession in ('running_coach', 'strength_coach', 'physiotherapist', 'nutritionist', 'run_captain')),
  headline text check (headline is null or char_length(headline) <= 120),
  bio text check (bio is null or char_length(bio) <= 2000),
  experience_years smallint check (experience_years between 0 and 60),
  specializations text[] not null default '{}' check (cardinality(specializations) <= 10),
  -- [{ "name": "...", "issuer": "...", "year": 2021, "reference": "licence no." }]
  credentials jsonb not null default '[]'::jsonb
    check (jsonb_typeof(credentials) = 'array' and jsonb_array_length(credentials) <= 10),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected', 'suspended')),
  verification_note text check (verification_note is null or char_length(verification_note) <= 500),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  listed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_verified_has_reviewer check (
    verification_status <> 'verified' or (verified_by is not null and verified_at is not null))
);
create trigger professional_profiles_updated_at before update on public.professional_profiles
  for each row execute function private.set_updated_at();

-- Editing credentials sends a verified profile back to review.
create function private.professional_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('hyd.verifying', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
  elsif new.credentials is distinct from old.credentials or new.profession is distinct from old.profession then
    if old.verification_status in ('verified', 'pending', 'rejected') then
      new.verification_status := 'unverified';
      new.verified_by := null;
      new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger professional_profiles_guard before insert or update on public.professional_profiles
  for each row execute function private.professional_profiles_guard();

alter table public.professional_profiles enable row level security;
revoke all on public.professional_profiles from anon, authenticated;
grant select on public.professional_profiles to authenticated;
grant insert (user_id, profession, headline, bio, experience_years, specializations, credentials, listed)
  on public.professional_profiles to authenticated;
grant update (profession, headline, bio, experience_years, specializations, credentials, listed)
  on public.professional_profiles to authenticated;
grant delete on public.professional_profiles to authenticated;
create policy "professional_profiles: owner" on public.professional_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Others see listed profiles that are not suspended, and admins see all.
create policy "professional_profiles: listed or admin" on public.professional_profiles for select to authenticated
  using ((listed and verification_status <> 'suspended') or (select private.has_role('admin')));

create function public.request_professional_verification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform set_config('hyd.verifying', 'on', true);
  update public.professional_profiles
     set verification_status = 'pending', verification_note = null
   where user_id = (select auth.uid()) and verification_status in ('unverified', 'rejected')
     and jsonb_array_length(credentials) > 0;
  get diagnostics n = row_count;
  perform set_config('hyd.verifying', 'off', true);
  if n = 0 then
    raise exception 'add at least one credential first, or a review is already in progress' using errcode = '22023';
  end if;
  perform private.write_audit('professional.verification_requested', 'professional_profile',
                              (select auth.uid())::text, (select auth.uid()), '{}'::jsonb);
end;
$$;
revoke all on function public.request_professional_verification() from public, anon;
grant execute on function public.request_professional_verification() to authenticated;

create function public.review_professional(p_user uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not private.has_role('admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_status not in ('verified', 'rejected', 'suspended', 'unverified') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'you cannot review your own profile' using errcode = '42501';
  end if;
  perform set_config('hyd.verifying', 'on', true);
  update public.professional_profiles
     set verification_status = p_status,
         verification_note = nullif(btrim(coalesce(p_note, '')), ''),
         verified_by = case when p_status = 'verified' then (select auth.uid()) end,
         verified_at = case when p_status = 'verified' then now() end
   where user_id = p_user;
  get diagnostics n = row_count;
  perform set_config('hyd.verifying', 'off', true);
  if n = 0 then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  perform private.write_audit('professional.' || p_status, 'professional_profile', p_user::text, p_user,
                              jsonb_build_object('note', left(coalesce(p_note, ''), 200)));
  perform private.notify(p_user, 'professional_review', 'Your professional profile was reviewed',
                         'Status: ' || p_status, '/coach/profile');
end;
$$;
revoke all on function public.review_professional(uuid, text, text) from public, anon;
grant execute on function public.review_professional(uuid, text, text) to authenticated;
