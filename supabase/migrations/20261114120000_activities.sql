-- Activities: GPX/FIT import (Release 2, workstream A).
--
-- * public.activities holds what may be shown to others (subject to
--   visibility): type, times, distance, pace, splits, best efforts, elevation
--   and a privacy-trimmed route. public.activity_tracks holds what never
--   leaves the owner: the full route, timestamped GPS samples, heart rate,
--   cadence and the original file reference.
-- * Runners register an upload and may later change only the name,
--   visibility and privacy trim. Every processed metric is written by
--   public.finalize_activity_import(), callable only by the service role,
--   after the server has parsed and validated the file. Clients can never
--   write metrics, which feed XP and challenges.
-- * Duplicates: the same file (SHA-256) or a ready activity starting within
--   60 s with a distance within 3% is refused, under a per-user lock.
-- * Each ready activity is linked to exactly one workout log: an existing
--   manual/timer log of the same session when one exists, otherwise a new
--   log with source 'import'. Rewards therefore count it once.

-- Workout logs may now come from an import.
alter table public.workout_logs drop constraint workout_logs_source_check;
alter table public.workout_logs
  add constraint workout_logs_source_check check (source in ('timer', 'manual', 'simulated', 'import'));

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_type text not null default 'run' check (activity_type in ('run', 'walk_run', 'walk', 'hike')),
  name text check (name is null or char_length(name) between 1 and 120),
  visibility text not null default 'private' check (visibility in ('private', 'followers', 'public')),
  -- Metres removed from each end of the shared route (home/work privacy).
  privacy_trim_m integer not null default 200 check (privacy_trim_m in (0, 200, 500, 1000)),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 300),
  source_format text check (source_format in ('gpx', 'fit')),
  import_source text not null default 'upload' check (import_source in ('upload')),
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_seconds integer check (elapsed_seconds between 60 and 172800),
  moving_seconds integer check (moving_seconds between 1 and 172800),
  moving_source text check (moving_source in ('device', 'derived')),
  distance_m numeric(9, 1) check (distance_m between 100 and 300000),
  avg_pace_s integer check (avg_pace_s > 0),
  elevation_gain_m numeric(7, 1),
  elevation_loss_m numeric(7, 1),
  elevation_profile jsonb,
  km_splits jsonb,
  mile_splits jsonb,
  best_efforts jsonb not null default '{}'::jsonb,
  has_gps boolean,
  public_path extensions.geography(LineString, 4326),
  workout_log_id uuid references public.workout_logs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_ready_has_metrics check (
    status <> 'ready'
    or (started_at is not null and ended_at is not null and elapsed_seconds is not null
        and moving_seconds is not null and distance_m is not null and source_format is not null)
  )
);

create index activities_user_started_idx on public.activities (user_id, started_at desc nulls last, id desc);
create index activities_public_idx on public.activities (started_at desc, id desc) where status = 'ready' and visibility = 'public';
create unique index activities_one_per_workout_log on public.activities (workout_log_id) where workout_log_id is not null;

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function private.set_updated_at();

create table public.activity_tracks (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  path extensions.geography(LineString, 4326),
  -- [[secondsFromStart, lat, lon, ele, cumulativeMetres], ...], downsampled.
  samples jsonb not null check (jsonb_typeof(samples) = 'array'),
  avg_heart_rate smallint check (avg_heart_rate between 20 and 260),
  max_heart_rate smallint check (max_heart_rate between 20 and 260),
  avg_cadence smallint check (avg_cadence between 1 and 400),
  file_path text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes integer not null check (file_bytes > 0),
  glitches_removed integer not null default 0
);

create unique index activity_tracks_user_file_idx on public.activity_tracks (user_id, file_sha256);
create index activity_tracks_path_gix on public.activity_tracks using gist (path);

-- ---------------------------------------------------------------------------
-- Visibility (followers arrive with Social v1, which replaces this function)
-- ---------------------------------------------------------------------------

create function private.can_view_activity(p_owner uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_owner = (select auth.uid()) or p_visibility = 'public', false);
$$;

revoke all on function private.can_view_activity(uuid, text) from public;
grant execute on function private.can_view_activity(uuid, text) to authenticated;

revoke all on public.activities, public.activity_tracks from anon, authenticated;
grant select on public.activities to authenticated;
grant insert (id, activity_type, name, visibility, privacy_trim_m, user_id) on public.activities to authenticated;
grant update (name, visibility, privacy_trim_m) on public.activities to authenticated;
grant delete on public.activities to authenticated;
grant select on public.activity_tracks to authenticated;

alter table public.activities enable row level security;
alter table public.activity_tracks enable row level security;

create policy "activities: owner reads all, others per visibility"
  on public.activities for select to authenticated
  using (user_id = (select auth.uid())
         or (status = 'ready' and (select private.can_view_activity(user_id, visibility))));
create policy "activities: register own upload"
  on public.activities for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "activities: owner edits"
  on public.activities for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "activities: owner deletes"
  on public.activities for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "activity_tracks: owner only"
  on public.activity_tracks for select to authenticated
  using (user_id = (select auth.uid()));

-- Uploads are limited per runner.
create function private.rate_limit_activity_uploads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('activity_upload:burst', 20, interval '1 hour');
  perform private.enforce_rate_limit('activity_upload:day', 100, interval '1 day');
  return new;
end;
$$;

create trigger activities_rate_limit before insert on public.activities
  for each row execute function private.rate_limit_activity_uploads();

-- Changing the trim recomputes nothing client-side: the stored public path is
-- re-derived from the owner's full track.
create function private.retrim_public_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_path extensions.geography;
  total numeric;
begin
  if new.privacy_trim_m is not distinct from old.privacy_trim_m or new.status <> 'ready' then
    return new;
  end if;
  select t.path into full_path from public.activity_tracks t where t.activity_id = new.id;
  if full_path is null then
    return new;
  end if;
  total := extensions.st_length(full_path);
  if total <= new.privacy_trim_m * 2 + 100 then
    new.public_path := null;
  else
    new.public_path := extensions.st_linesubstring(
      full_path::extensions.geometry,
      new.privacy_trim_m / total,
      1 - new.privacy_trim_m / total)::extensions.geography;
  end if;
  return new;
end;
$$;

create trigger activities_retrim
  before update of privacy_trim_m on public.activities
  for each row execute function private.retrim_public_path();

-- ---------------------------------------------------------------------------
-- Finalisation (service role only)
-- ---------------------------------------------------------------------------

create function public.finalize_activity_import(p_activity_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.activities%rowtype;
  started timestamptz := (p_payload ->> 'startedAt')::timestamptz;
  dist numeric := (p_payload ->> 'distanceMeters')::numeric;
  elapsed integer := (p_payload ->> 'elapsedSeconds')::integer;
  moving integer := (p_payload ->> 'movingSeconds')::integer;
  log_id uuid;
  linked boolean := false;
  dup uuid;
begin
  select * into a from public.activities where id = p_activity_id for update;
  if not found then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;
  if a.status = 'ready' then
    return jsonb_build_object('status', 'ready', 'workoutLogId', a.workout_log_id, 'alreadyProcessed', true);
  end if;

  -- Serialise imports per runner so duplicates cannot slip through in parallel.
  perform pg_advisory_xact_lock(hashtextextended(a.user_id::text || ':activity_import', 0));

  select t.activity_id into dup from public.activity_tracks t
   where t.user_id = a.user_id and t.file_sha256 = p_payload ->> 'sha256' and t.activity_id <> a.id;
  if dup is null then
    select x.id into dup from public.activities x
     where x.user_id = a.user_id and x.id <> a.id and x.status = 'ready'
       and abs(extract(epoch from (x.started_at - started))) <= 60
       and abs(x.distance_m - dist) <= greatest(dist * 0.03, 50);
  end if;
  if dup is not null then
    update public.activities set status = 'failed', failure_reason = 'duplicate:' || dup::text where id = a.id;
    return jsonb_build_object('status', 'duplicate', 'duplicateOf', dup);
  end if;

  update public.activities set
    status = 'ready',
    failure_reason = null,
    source_format = p_payload ->> 'format',
    name = coalesce(a.name, nullif(left(p_payload ->> 'name', 120), '')),
    started_at = started,
    ended_at = (p_payload ->> 'endedAt')::timestamptz,
    elapsed_seconds = elapsed,
    moving_seconds = moving,
    moving_source = p_payload ->> 'movingSource',
    distance_m = dist,
    avg_pace_s = (p_payload ->> 'avgPace')::integer,
    elevation_gain_m = (p_payload ->> 'elevationGain')::numeric,
    elevation_loss_m = (p_payload ->> 'elevationLoss')::numeric,
    elevation_profile = p_payload -> 'elevationProfile',
    km_splits = p_payload -> 'kmSplits',
    mile_splits = p_payload -> 'mileSplits',
    best_efforts = coalesce(p_payload -> 'bestEfforts', '{}'::jsonb),
    has_gps = (p_payload ->> 'hasGps')::boolean,
    public_path = case when p_payload ->> 'publicPathWkt' is null then null
                       else extensions.st_geogfromtext(p_payload ->> 'publicPathWkt') end
  where id = a.id;

  insert into public.activity_tracks (activity_id, user_id, path, samples, avg_heart_rate, max_heart_rate, avg_cadence,
                                      file_path, file_sha256, file_bytes, glitches_removed)
  values (a.id, a.user_id,
          case when p_payload ->> 'pathWkt' is null then null else extensions.st_geogfromtext(p_payload ->> 'pathWkt') end,
          p_payload -> 'samples', (p_payload ->> 'avgHeartRate')::smallint, (p_payload ->> 'maxHeartRate')::smallint,
          (p_payload ->> 'avgCadence')::smallint, p_payload ->> 'filePath', p_payload ->> 'sha256',
          (p_payload ->> 'fileBytes')::integer, coalesce((p_payload ->> 'glitchesRemoved')::integer, 0))
  on conflict (activity_id) do update set
    path = excluded.path, samples = excluded.samples, avg_heart_rate = excluded.avg_heart_rate,
    max_heart_rate = excluded.max_heart_rate, avg_cadence = excluded.avg_cadence, file_sha256 = excluded.file_sha256,
    file_bytes = excluded.file_bytes, glitches_removed = excluded.glitches_removed;

  -- Reconcile with a manual or timer log of the same session (no double counting).
  select w.id into log_id from public.workout_logs w
   where w.user_id = a.user_id and w.status = 'completed' and w.source in ('manual', 'timer')
     and abs(extract(epoch from (w.started_at - started))) <= 900
     and not exists (select 1 from public.activities x where x.workout_log_id = w.id)
   order by abs(extract(epoch from (w.started_at - started)))
   limit 1;
  if log_id is not null then
    linked := true;
  elsif elapsed between 60 and 21600 and dist <= 100000 then
    insert into public.workout_logs (user_id, status, title, workout_type, started_at, completed_at, duration_seconds,
                                     distance_meters, source, idempotency_key)
    values (a.user_id, 'completed', coalesce(a.name, nullif(left(p_payload ->> 'name', 120), ''), 'Imported activity'),
            case a.activity_type when 'hike' then 'walk' else a.activity_type end,
            started, started + make_interval(secs => elapsed), elapsed, round(dist)::integer, 'import', a.id)
    on conflict (user_id, idempotency_key) do update set updated_at = now()
    returning id into log_id;
  end if;
  update public.activities set workout_log_id = log_id where id = a.id;

  return jsonb_build_object('status', 'ready', 'workoutLogId', log_id, 'linkedExisting', linked);
end;
$$;

revoke all on function public.finalize_activity_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_activity_import(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private `activity-files` bucket, one folder per runner.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('activity-files', 'activity-files', false, 15728640)
on conflict (id) do nothing;

create policy "activity-files: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'activity-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "activity-files: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'activity-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "activity-files: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'activity-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- GeoJSON computed fields for maps (PostgREST exposes them by name).
create function public.activity_public_geojson(a public.activities)
returns json
language sql
stable
set search_path = ''
as $$
  select extensions.st_asgeojson(extensions.st_simplify(a.public_path::extensions.geometry, 0.00001), 6)::json;
$$;

-- Owner-only by construction: activity_tracks rows are visible only to their owner.
create function public.activity_track_geojson(t public.activity_tracks)
returns json
language sql
stable
set search_path = ''
as $$
  select extensions.st_asgeojson(extensions.st_simplify(t.path::extensions.geometry, 0.00001), 6)::json;
$$;

grant execute on function public.activity_public_geojson(public.activities) to authenticated;
grant execute on function public.activity_track_geojson(public.activity_tracks) to authenticated;
