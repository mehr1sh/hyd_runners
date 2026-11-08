-- Group runs and pace pods (Release 1, workstream C).
--
-- A group-run series describes a recurring run (weekday, local start time,
-- meeting point, regroup policy, pace-group template). Scheduling turns it
-- into ordinary events, so RSVPs, waiting lists, pace groups, captains,
-- sweepers and check-in all come from Events v2. Scheduling is idempotent:
-- one event per series and start time.

create table public.group_run_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  location_id uuid references public.locations (id) on delete set null,
  meeting_point text check (meeting_point is null or char_length(meeting_point) between 1 and 200),
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  start_time time not null,
  duration_minutes smallint not null default 60 check (duration_minutes between 15 and 360),
  timezone text not null default 'Asia/Kolkata',
  capacity integer check (capacity is null or capacity > 0),
  beginner_friendly boolean not null default false,
  no_drop boolean not null default true,
  regroup_policy text not null default 'We regroup at every turn and at each kilometre marker. Nobody runs alone.'
    check (char_length(regroup_policy) between 1 and 300),
  -- [{label, min_pace_seconds, max_pace_seconds, run_walk}]
  pace_groups jsonb not null default '[
    {"label": "5:00–5:30", "min_pace_seconds": 300, "max_pace_seconds": 330, "run_walk": false},
    {"label": "5:30–6:00", "min_pace_seconds": 330, "max_pace_seconds": 360, "run_walk": false},
    {"label": "6:00–6:30", "min_pace_seconds": 360, "max_pace_seconds": 390, "run_walk": false},
    {"label": "6:30–7:30", "min_pace_seconds": 390, "max_pace_seconds": 450, "run_walk": false},
    {"label": "Run-walk", "min_pace_seconds": null, "max_pace_seconds": null, "run_walk": true}
  ]'::jsonb check (jsonb_typeof(pace_groups) = 'array' and jsonb_array_length(pace_groups) <= 10),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index group_run_series_club_idx on public.group_run_series (club_id);

create trigger group_run_series_set_updated_at
  before update on public.group_run_series
  for each row execute function private.set_updated_at();

create function private.validate_series()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g jsonb;
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'Unknown timezone' using errcode = '22023';
  end if;
  for g in select * from jsonb_array_elements(new.pace_groups) loop
    if coalesce(char_length(g ->> 'label'), 0) not between 1 and 60
       or (g ? 'min_pace_seconds' and jsonb_typeof(g -> 'min_pace_seconds') not in ('number', 'null'))
       or (g ? 'max_pace_seconds' and jsonb_typeof(g -> 'max_pace_seconds') not in ('number', 'null'))
       or ((g ->> 'min_pace_seconds')::int is not null and (g ->> 'max_pace_seconds')::int is not null
           and (g ->> 'min_pace_seconds')::int >= (g ->> 'max_pace_seconds')::int) then
      raise exception 'Each pace group needs a label and a fastest-to-slowest range' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create trigger group_run_series_validate
  before insert or update on public.group_run_series
  for each row execute function private.validate_series();

alter table public.events add column series_id uuid references public.group_run_series (id) on delete set null;
create unique index events_series_start_idx on public.events (series_id, starts_at) where series_id is not null;

-- Managers manage any series; club admins manage their club's series.
create function private.can_manage_series(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or (p_club is not null and private.club_role(p_club) = 'admin'),
    false);
$$;

revoke all on function private.can_manage_series(uuid) from public;
grant execute on function private.can_manage_series(uuid) to authenticated;

revoke all on public.group_run_series from anon, authenticated;
grant select on public.group_run_series to anon, authenticated;
grant insert, update, delete on public.group_run_series to authenticated;
alter table public.group_run_series enable row level security;

create policy "group_run_series: anyone reads active series"
  on public.group_run_series for select to anon, authenticated
  using (active or (select private.can_manage_series(club_id)));
create policy "group_run_series: organisers create"
  on public.group_run_series for insert to authenticated
  with check ((select private.can_manage_series(club_id)) and created_by = (select auth.uid()));
create policy "group_run_series: organisers update"
  on public.group_run_series for update to authenticated
  using ((select private.can_manage_series(club_id)))
  with check ((select private.can_manage_series(club_id)));
create policy "group_run_series: organisers delete"
  on public.group_run_series for delete to authenticated
  using ((select private.can_manage_series(club_id)));

-- Create the series' events for the coming weeks (1–8). Existing ones are
-- left alone. Returns how many were created.
create function public.schedule_series_runs(p_series_id uuid, p_weeks integer default 4)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.group_run_series%rowtype;
  local_today date;
  day date;
  starts timestamptz;
  new_event uuid;
  created integer := 0;
  g jsonb;
  i integer;
begin
  select * into s from public.group_run_series where id = p_series_id;
  if not found then
    raise exception 'Series not found' using errcode = 'P0002';
  end if;
  if not private.can_manage_series(s.club_id) then
    raise exception 'Only the series organisers can schedule runs' using errcode = '42501';
  end if;
  if not s.active then
    raise exception 'This series is paused' using errcode = '23514';
  end if;
  if p_weeks not between 1 and 8 then
    raise exception 'Schedule between 1 and 8 weeks ahead' using errcode = '22023';
  end if;

  local_today := (now() at time zone s.timezone)::date;
  for day in
    select d::date from generate_series(local_today, local_today + (p_weeks * 7 - 1), interval '1 day') d
    where extract(isodow from d) = s.weekday
  loop
    starts := (day + s.start_time) at time zone s.timezone;
    continue when starts <= now();
    insert into public.events (title, description, starts_at, ends_at, location_id, capacity, status, created_by,
                               category, meeting_point, club_id, series_id)
    values (s.title, s.description, starts, starts + make_interval(mins => s.duration_minutes), s.location_id,
            s.capacity, 'published', (select auth.uid()),
            case when s.beginner_friendly then 'beginner' else 'group_run' end,
            s.meeting_point, s.club_id, s.id)
    on conflict (series_id, starts_at) where series_id is not null do nothing
    returning id into new_event;
    if new_event is not null then
      created := created + 1;
      i := 0;
      for g in select * from jsonb_array_elements(s.pace_groups) loop
        insert into public.event_pace_groups (event_id, label, min_pace_seconds, max_pace_seconds, run_walk, notes, sort_order)
        values (new_event, g ->> 'label', (g ->> 'min_pace_seconds')::int, (g ->> 'max_pace_seconds')::int,
                coalesce((g ->> 'run_walk')::boolean, false),
                case when s.no_drop then 'No-drop: the group waits for everyone.' end, i);
        i := i + 1;
      end loop;
      new_event := null;
    end if;
  end loop;

  perform private.write_audit('group_run_series.scheduled', 'group_run_series', s.id::text, null,
    jsonb_build_object('weeks', p_weeks, 'created', created));
  return created;
end;
$$;

-- Past runs of a series with attendance counts (counts only).
create function public.series_history(p_series_id uuid, p_limit integer default 12)
returns table (event_id uuid, starts_at timestamptz, going bigint, checked_in bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.starts_at,
         count(r.user_id) filter (where r.status = 'going'),
         count(r.user_id) filter (where r.checked_in_at is not null)
  from public.events e
  join public.group_run_series s on s.id = e.series_id and s.active
  left join public.event_rsvps r on r.event_id = e.id
  where e.series_id = p_series_id and e.status = 'published' and e.ends_at < now()
  group by e.id, e.starts_at
  order by e.starts_at desc
  limit least(greatest(p_limit, 1), 52);
$$;

revoke all on function public.schedule_series_runs(uuid, integer) from public, anon;
revoke all on function public.series_history(uuid, integer) from public;
grant execute on function public.schedule_series_runs(uuid, integer) to authenticated;
grant execute on function public.series_history(uuid, integer) to anon, authenticated;
