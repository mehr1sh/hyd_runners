-- Routes v1 (Release 1, workstream D).
--
-- * Routes are LineStrings in PostGIS. Distance and "is it a loop" are
--   computed by the database, never taken from the client.
-- * Every route records where it came from: an uploaded GPX track or a
--   traced OpenStreetMap way, with attribution. A route is "verified" only
--   when a programme manager or admin marks it so; nothing is verified by
--   default. Unknown attributes stay unknown (null / 'unknown').
-- * Programme managers and admins publish routes; club admins may submit
--   drafts for review.
-- * Community reviews (ratings per aspect, comments without names) and
--   time-limited hazard/closure reports that always show their age.
-- * Events and group-run series can link a route.

create extension if not exists postgis with schema extensions;

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  area text check (area is null or char_length(area) between 2 and 80),
  location_id uuid references public.locations (id) on delete set null,
  path extensions.geography(LineString, 4326) not null,
  -- Computed by trigger from path.
  distance_m numeric(9, 1) not null default 0,
  is_loop boolean not null default false,
  start_point extensions.geography(Point, 4326),
  -- Only from data that carries elevations (e.g. GPX <ele>); otherwise null.
  elevation_gain_m numeric(7, 1) check (elevation_gain_m is null or elevation_gain_m >= 0),
  elevation_loss_m numeric(7, 1) check (elevation_loss_m is null or elevation_loss_m >= 0),
  elevation_profile jsonb check (elevation_profile is null or jsonb_typeof(elevation_profile) = 'array'),
  surface text not null default 'unknown' check (surface in ('road', 'track', 'trail', 'mixed', 'unknown')),
  terrain text not null default 'unknown' check (terrain in ('flat', 'rolling', 'hilly', 'unknown')),
  difficulty text not null default 'unknown' check (difficulty in ('easy', 'moderate', 'hard', 'unknown')),
  beginner_suitable boolean,
  lighting text not null default 'unknown' check (lighting in ('lit', 'partly_lit', 'unlit', 'unknown')),
  shade text not null default 'unknown' check (shade in ('good', 'some', 'little', 'unknown')),
  water_refill boolean,
  toilets boolean,
  parking text check (parking is null or char_length(parking) <= 200),
  meeting_point text check (meeting_point is null or char_length(meeting_point) <= 200),
  traffic_notes text check (traffic_notes is null or char_length(traffic_notes) <= 500),
  source text not null check (source in ('osm', 'gpx')),
  source_ref text not null check (char_length(source_ref) between 1 and 500),
  source_attribution text not null check (char_length(source_attribution) between 1 and 300),
  verified boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routes_verified_has_verifier check (not verified or (verified_by is not null and verified_at is not null))
);

create index routes_path_gix on public.routes using gist (path);
create index routes_start_gix on public.routes using gist (start_point);
create index routes_status_idx on public.routes (status, name);

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function private.set_updated_at();

-- Derived values come from the geometry. Paths must be in the Hyderabad
-- metropolitan area and between 200 m and 100 km long.
create function private.routes_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g extensions.geometry := new.path::extensions.geometry;
begin
  if extensions.st_npoints(g) < 2 then
    raise exception 'A route needs at least two points' using errcode = '23514';
  end if;
  if not extensions.st_within(g, extensions.st_makeenvelope(77.9, 16.9, 79.0, 17.9, 4326)) then
    raise exception 'Routes must be in the Hyderabad area' using errcode = '23514';
  end if;
  new.distance_m := round(extensions.st_length(new.path)::numeric, 1);
  if new.distance_m < 200 or new.distance_m > 100000 then
    raise exception 'Routes must be between 200 m and 100 km long' using errcode = '23514';
  end if;
  new.start_point := extensions.st_startpoint(g)::extensions.geography;
  new.is_loop := extensions.st_distance(extensions.st_startpoint(g)::extensions.geography,
                                        extensions.st_endpoint(g)::extensions.geography) <= 150;
  return new;
end;
$$;

create trigger routes_derive
  before insert or update of path on public.routes
  for each row execute function private.routes_derive();

-- Only managers verify; verification is stamped by the database.
create function private.routes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_manager boolean := (select private.has_role('programme_manager')) or (select private.has_role('admin'));
begin
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  elsif new.created_by is distinct from old.created_by then
    raise exception 'A route''s author cannot change' using errcode = '42501';
  end if;
  if not is_manager then
    if new.verified or new.status <> 'draft' then
      raise exception 'Only programme managers publish or verify routes' using errcode = '42501';
    end if;
  end if;
  if new.verified and (tg_op = 'INSERT' or not old.verified) then
    new.verified_by := (select auth.uid());
    new.verified_at := now();
  elsif not new.verified then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger routes_guard
  before insert or update on public.routes
  for each row execute function private.routes_guard();

-- Managers and admins; club admins of any club may submit drafts.
create function private.can_contribute_routes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or exists (select 1 from public.club_members m where m.user_id = (select auth.uid()) and m.role = 'admin' and m.status = 'active'),
    false);
$$;

revoke all on function private.can_contribute_routes() from public;
grant execute on function private.can_contribute_routes() to authenticated;

revoke all on public.routes from anon, authenticated;
grant select on public.routes to anon, authenticated;
grant insert (id, slug, name, description, area, location_id, path, elevation_gain_m, elevation_loss_m, elevation_profile,
              surface, terrain, difficulty, beginner_suitable, lighting, shade, water_refill, toilets, parking,
              meeting_point, traffic_notes, source, source_ref, source_attribution, verified, status)
  on public.routes to authenticated;
grant update (name, description, area, location_id, surface, terrain, difficulty, beginner_suitable, lighting, shade,
              water_refill, toilets, parking, meeting_point, traffic_notes, verified, status)
  on public.routes to authenticated;
alter table public.routes enable row level security;

create policy "routes: anyone reads published"
  on public.routes for select to anon, authenticated
  using (status = 'published');
create policy "routes: contributors read own drafts, managers read all"
  on public.routes for select to authenticated
  using (created_by = (select auth.uid())
         or (select private.has_role('programme_manager')) or (select private.has_role('admin')));
create policy "routes: contributors create"
  on public.routes for insert to authenticated
  with check ((select private.can_contribute_routes()));
create policy "routes: managers or the author's drafts update"
  on public.routes for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin'))
         or (created_by = (select auth.uid()) and status = 'draft'))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin'))
              or (created_by = (select auth.uid()) and status = 'draft'));

-- GeoJSON for maps: a computed field PostgREST exposes as route_geojson.
create function public.route_geojson(r public.routes)
returns json
language sql
stable
set search_path = ''
as $$
  select extensions.st_asgeojson(extensions.st_simplify(r.path::extensions.geometry, 0.00002), 6)::json;
$$;

grant execute on function public.route_geojson(public.routes) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create table public.route_reviews (
  route_id uuid not null references public.routes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  safety smallint check (safety between 1 and 5),
  shade smallint check (shade between 1 and 5),
  surface smallint check (surface between 1 and 5),
  crowd smallint check (crowd between 1 and 5),
  comment text check (comment is null or char_length(comment) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (route_id, user_id)
);

create trigger route_reviews_set_updated_at
  before update on public.route_reviews
  for each row execute function private.set_updated_at();

revoke all on public.route_reviews from anon, authenticated;
grant select, delete on public.route_reviews to authenticated;
grant insert (route_id, user_id, rating, safety, shade, surface, crowd, comment) on public.route_reviews to authenticated;
grant update (rating, safety, shade, surface, crowd, comment) on public.route_reviews to authenticated;
alter table public.route_reviews enable row level security;

create policy "route_reviews: own rows" on public.route_reviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy "route_reviews: review published routes" on public.route_reviews for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.routes r where r.id = route_id and r.status = 'published'));
create policy "route_reviews: edit own" on public.route_reviews for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "route_reviews: delete own or manage" on public.route_reviews for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.has_role('programme_manager')) or (select private.has_role('admin')));

-- Averages and counts per aspect, and recent comments without names.
create function public.route_review_summary(p_route_ids uuid[])
returns table (route_id uuid, reviews bigint, rating numeric, safety numeric, shade numeric, surface numeric, crowd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.route_id, count(*), round(avg(r.rating), 1), round(avg(r.safety), 1), round(avg(r.shade), 1),
         round(avg(r.surface), 1), round(avg(r.crowd), 1)
  from public.route_reviews r
  join public.routes ro on ro.id = r.route_id and ro.status = 'published'
  where r.route_id = any (p_route_ids)
  group by r.route_id;
$$;

create function public.route_review_comments(p_route_id uuid)
returns table (rating smallint, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rating, r.comment, r.created_at
  from public.route_reviews r
  join public.routes ro on ro.id = r.route_id and ro.status = 'published'
  where r.route_id = p_route_id and r.comment is not null
  order by r.created_at desc
  limit 20;
$$;

revoke all on function public.route_review_summary(uuid[]) from public;
revoke all on function public.route_review_comments(uuid) from public;
grant execute on function public.route_review_summary(uuid[]) to anon, authenticated;
grant execute on function public.route_review_comments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Community condition reports (hazards, closures, construction, lighting…)
-- ---------------------------------------------------------------------------

create table public.route_reports (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('hazard', 'closure', 'construction', 'lighting', 'traffic', 'water', 'other')),
  note text not null check (char_length(note) between 3 and 500),
  created_at timestamptz not null default now(),
  -- Reports fade unless re-confirmed; the page always shows their age.
  expires_at timestamptz not null default now() + interval '14 days',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index route_reports_active_idx on public.route_reports (route_id, created_at desc) where resolved_at is null;

revoke all on public.route_reports from anon, authenticated;
grant select on public.route_reports to authenticated;
grant insert (route_id, reporter_id, kind, note) on public.route_reports to authenticated;
grant update (resolved_at, resolved_by) on public.route_reports to authenticated;
alter table public.route_reports enable row level security;

create policy "route_reports: read on published routes" on public.route_reports for select to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and r.status = 'published'));
create policy "route_reports: report on published routes" on public.route_reports for insert to authenticated
  with check (reporter_id = (select auth.uid())
              and exists (select 1 from public.routes r where r.id = route_id and r.status = 'published'));
create policy "route_reports: managers resolve" on public.route_reports for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create function private.rate_limit_route_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('route_report:day', 10, interval '1 day');
  return new;
end;
$$;

create trigger route_reports_rate_limit before insert on public.route_reports
  for each row execute function private.rate_limit_route_reports();

-- ---------------------------------------------------------------------------
-- Links from events and group runs
-- ---------------------------------------------------------------------------

alter table public.events add column route_id uuid references public.routes (id) on delete set null;
alter table public.group_run_series add column route_id uuid references public.routes (id) on delete set null;
create index events_route_idx on public.events (route_id);

-- Scheduled runs inherit the series route (replaces 20261112120000's version
-- only to copy route_id; behaviour is otherwise unchanged).
create or replace function public.schedule_series_runs(p_series_id uuid, p_weeks integer default 4)
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
                               category, meeting_point, club_id, series_id, route_id)
    values (s.title, s.description, starts, starts + make_interval(mins => s.duration_minutes), s.location_id,
            s.capacity, 'published', (select auth.uid()),
            case when s.beginner_friendly then 'beginner' else 'group_run' end,
            s.meeting_point, s.club_id, s.id, s.route_id)
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

-- Audit verification and publication changes.
create function private.audit_routes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified is distinct from old.verified or new.status is distinct from old.status then
    perform private.write_audit('route.reviewed', 'route', new.id::text, null,
      jsonb_build_object('status', new.status, 'verified', new.verified));
  end if;
  return new;
end;
$$;

create trigger routes_audit after update on public.routes
  for each row execute function private.audit_routes();

-- ---------------------------------------------------------------------------
-- Curated Hyderabad routes traced from OpenStreetMap (ways fetched from the
-- OSM API on 2026-11-08). Not verified on the ground; attributes that OSM does
-- not record stay unknown. Re-running is a no-op.
-- ---------------------------------------------------------------------------

insert into public.routes (id, slug, name, description, area, location_id, path, surface, terrain, source, source_ref, source_attribution, status) values
  ('5eed0005-0000-4000-8000-000000000001', 'kbr-park-nature-trail', 'KBR Park Nature Trail', 'A footway through KBR National Park, traced from OpenStreetMap. It is a point-to-point trail of about 1 km; run it out and back for a longer session. Check the park''s opening hours and entry rules before you go.', 'Jubilee Hills', '5eed0001-0000-4000-8000-000000000001',
   extensions.st_geogfromtext('SRID=4326;LINESTRING(78.4199093 17.4211608, 78.4199343 17.4207864, 78.4199865 17.4206422, 78.4200305 17.4205583, 78.4200222 17.4204403, 78.4199958 17.4203857, 78.4199398 17.4202700, 78.4198409 17.4200838, 78.4197035 17.4198243, 78.4196293 17.4195989, 78.4196184 17.4194967, 78.4195277 17.4194154, 78.4194343 17.4193472, 78.4193766 17.4193132, 78.4191815 17.4191611, 78.4191128 17.4190877, 78.4190194 17.4188125, 78.4190029 17.4186788, 78.4190139 17.4185294, 78.4191128 17.4183197, 78.4194178 17.4180575, 78.4198381 17.4178164, 78.4203389 17.4176363, 78.4209181 17.4174599, 78.4213063 17.4172894, 78.4216576 17.4171894, 78.4217870 17.4170072, 78.4218856 17.4168719, 78.4221259 17.4166250, 78.4222245 17.4164780, 78.4222060 17.4163839, 78.4222183 17.4162546, 78.4223416 17.4161429, 78.4225634 17.4160311, 78.4227051 17.4159900, 78.4228469 17.4159900, 78.4231118 17.4159959, 78.4233768 17.4159371, 78.4236418 17.4158606, 78.4238574 17.4158489, 78.4239807 17.4158489, 78.4241605 17.4158835)'),
   'unknown', 'unknown', 'osm', 'osm:way/354531183 (version 4)',
   'Route geometry © OpenStreetMap contributors, available under the Open Database Licence (ODbL).', 'published'),
  ('5eed0005-0000-4000-8000-000000000002', 'bachupally-jogging-track', 'Bachupally Jogging Track', 'A short jogging-track loop in Bachupally, traced from OpenStreetMap. Laps make it easy to measure distance.', 'Bachupally', null,
   extensions.st_geogfromtext('SRID=4326;LINESTRING(78.3582930 17.5288473, 78.3580772 17.5281855, 78.3580521 17.5279364, 78.3576990 17.5278162, 78.3576327 17.5278551, 78.3575265 17.5280019, 78.3574821 17.5280571, 78.3573853 17.5283779, 78.3573836 17.5284066, 78.3573871 17.5284370, 78.3574614 17.5286547, 78.3575269 17.5286395, 78.3575835 17.5286327, 78.3576366 17.5286327, 78.3576667 17.5286597, 78.3578348 17.5290512, 78.3582930 17.5288473)'),
   'unknown', 'unknown', 'osm', 'osm:way/380940050 (version 3)',
   'Route geometry © OpenStreetMap contributors, available under the Open Database Licence (ODbL).', 'published')
on conflict (id) do nothing;
