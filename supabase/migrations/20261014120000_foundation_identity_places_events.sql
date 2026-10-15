-- HYD Runners foundation schema: profiles, roles, locations, events.
-- Owner: lead. Feature tables belong in later migrations (see CONTRIBUTING.md).
--
-- Conventions
--   * UUID primary keys; user-owned rows reference profiles(id) = auth.users(id).
--   * timestamptz everywhere, stored in UTC.
--   * RLS on every table in `public`; anon gets nothing unless granted below.
--   * Security-definer helpers live in the unexposed `private` schema.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Enums (mirror src/lib/contracts/index.ts)
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('runner', 'coach', 'mentor', 'programme_manager', 'admin');
create type public.fitness_level as enum ('new_to_running', 'returning', 'regular');
create type public.primary_need as enum ('consistency', 'schedule_conflicts', 'both');
create type public.location_kind as enum ('park', 'track', 'lake_loop', 'gym', 'trail', 'other');
create type public.event_status as enum ('draft', 'published', 'cancelled');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on sign-up
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_path text,
  fitness_level public.fitness_level,
  primary_need public.primary_need,
  timezone text not null default 'Asia/Kolkata',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing runner profile. id = auth.users.id.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_roles: a user may hold several roles; every user is at least a runner
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

-- Role check used inside RLS policies. Security definer so policies on
-- user_roles itself do not recurse. Lives in `private`, which the Data API
-- does not expose.
create function private.has_role(check_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = check_role
  );
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role in ('coach', 'mentor', 'programme_manager', 'admin')
  );
$$;

revoke all on function private.has_role(public.app_role) from public;
revoke all on function private.is_staff() from public;
grant execute on function private.has_role(public.app_role) to authenticated;
grant execute on function private.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Sign-up hook: create profile + runner role for every new auth user
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  name_from_meta text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(name_from_meta, split_part(coalesce(new.email, 'runner'), '@', 1), 'Runner'), 60)
  );

  insert into public.user_roles (user_id, role) values (new.id, 'runner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- locations: running spots shown on the map
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  kind public.location_kind not null default 'other',
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  address text,
  verified boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_lat_lng_idx on public.locations (latitude, longitude);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- events: community runs and meet-ups
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_id uuid references public.locations (id) on delete set null,
  capacity integer check (capacity is null or capacity > 0),
  status public.event_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_end_after_start check (ends_at > starts_at)
);

create index events_starts_at_idx on public.events (starts_at);
create index events_location_id_idx on public.events (location_id);
create index events_created_by_idx on public.events (created_by);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants: start from nothing, then grant only what each role needs.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.user_roles, public.locations, public.events from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_path, fitness_level, primary_need, timezone, onboarded_at)
  on public.profiles to authenticated;

grant select, insert, delete on public.user_roles to authenticated;

grant select on public.locations to anon, authenticated;
grant insert, update, delete on public.locations to authenticated;

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.locations enable row level security;
alter table public.events enable row level security;

-- profiles: runners see and edit themselves; managers and admins see everyone.
-- Coach/mentor visibility arrives with coach_assignments (community feature).
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: managers read all"
  on public.profiles for select to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- user_roles: read own; admins manage all; managers grant/revoke non-admin staff roles.
create policy "user_roles: read own"
  on public.user_roles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_roles: managers read all"
  on public.user_roles for select to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "user_roles: admin grants any"
  on public.user_roles for insert to authenticated
  with check ((select private.has_role('admin')));

create policy "user_roles: manager grants staff"
  on public.user_roles for insert to authenticated
  with check (
    (select private.has_role('programme_manager'))
    and role in ('runner', 'coach', 'mentor')
  );

create policy "user_roles: admin revokes any"
  on public.user_roles for delete to authenticated
  using ((select private.has_role('admin')));

create policy "user_roles: manager revokes staff"
  on public.user_roles for delete to authenticated
  using (
    (select private.has_role('programme_manager'))
    and role in ('coach', 'mentor')
  );

-- locations: public read; managers and admins write.
create policy "locations: anyone reads"
  on public.locations for select to anon, authenticated
  using (true);

create policy "locations: managers insert"
  on public.locations for insert to authenticated
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "locations: managers update"
  on public.locations for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "locations: managers delete"
  on public.locations for delete to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

-- events: published events are public; staff also see drafts; managers/admins write.
create policy "events: anyone reads published"
  on public.events for select to anon, authenticated
  using (status = 'published');

create policy "events: staff read all"
  on public.events for select to authenticated
  using ((select private.is_staff()));

create policy "events: managers insert"
  on public.events for insert to authenticated
  with check (
    ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
    and created_by = (select auth.uid())
  );

create policy "events: managers update"
  on public.events for update to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
  with check ((select private.has_role('programme_manager')) or (select private.has_role('admin')));

create policy "events: managers delete"
  on public.events for delete to authenticated
  using ((select private.has_role('programme_manager')) or (select private.has_role('admin')));
